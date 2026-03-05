#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = os.homedir();
const ROOT = path.join(HOME, "notes", "tasks");
const TASKS_JSON = path.join(ROOT, "tasks.json");
const RUNS_DIR = path.join(ROOT, "runs");
const OWNER = String(process.env.TASKS_OWNER || "<USER>").trim();

function nowIso() {
  return new Date().toISOString();
}

function args() {
  return process.argv.slice(2);
}

function has(flag) {
  return args().includes(flag);
}

function arg(flag, fallback = null) {
  const a = args();
  const i = a.indexOf(flag);
  return i >= 0 && i + 1 < a.length ? a[i + 1] : fallback;
}

function usage() {
  console.log(`tasks-kanban

Commands:
  init
  add --title "<title>" [--description "..."] [--priority 1-5] [--by <name>]
  list
  move --id <task_id> --to "To Do|In Progress|Done|Blocked" [--by <name>]
  update --id <task_id> --text "<update text>" [--by <agent_name>]
  mention --id <task_id> --to <agent_name> --text "<request>" [--by <agent_name>]

Rules enforced:
  - moving to "In Progress" creates ~/notes/tasks/runs/<task_id>/
  - updates append to .../runs/<task_id>/updates.md
  - only TASKS_OWNER can move to "Done" (default owner: ${OWNER})
  - @mention creates request entries for pickup
`);
}

function ensureDirs() {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

function newBoard() {
  return {
    schema_version: 1,
    updated_at: nowIso(),
    owner: OWNER,
    tasks: [],
  };
}

function readBoard() {
  ensureDirs();
  if (!fs.existsSync(TASKS_JSON)) return newBoard();
  try {
    return JSON.parse(fs.readFileSync(TASKS_JSON, "utf8"));
  } catch {
    throw new Error(`Invalid JSON: ${TASKS_JSON}`);
  }
}

function writeBoard(board) {
  board.updated_at = nowIso();
  fs.writeFileSync(TASKS_JSON, JSON.stringify(board, null, 2) + "\n", "utf8");
}

function mkId() {
  return crypto.randomUUID();
}

function by() {
  return String(arg("--by", process.env.USER || "agent")).trim();
}

function ensureRunFolder(taskId) {
  const runDir = path.join(RUNS_DIR, taskId);
  fs.mkdirSync(runDir, { recursive: true });
  const updates = path.join(runDir, "updates.md");
  if (!fs.existsSync(updates)) {
    fs.writeFileSync(
      updates,
      `# Task Updates: ${taskId}\n\n- created_at: ${nowIso()}\n\n`,
      "utf8"
    );
  }
  return { runDir, updates };
}

function appendUpdate(taskId, text, actor) {
  const { updates } = ensureRunFolder(taskId);
  fs.appendFileSync(
    updates,
    `## ${nowIso()} — ${actor}\n\n${text}\n\n`,
    "utf8"
  );
  return updates;
}

function statusNorm(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (raw === "to do" || raw === "todo" || raw === "to_do") return "To Do";
  if (raw === "in progress" || raw === "in_progress" || raw === "inprogress") return "In Progress";
  if (raw === "done") return "Done";
  if (raw === "blocked") return "Blocked";
  throw new Error(`Invalid status: ${input}`);
}

function cmdInit() {
  ensureDirs();
  if (!fs.existsSync(TASKS_JSON)) {
    writeBoard(newBoard());
    console.log(`✅ initialized ${TASKS_JSON}`);
  } else {
    console.log(`ℹ️ already exists: ${TASKS_JSON}`);
  }
}

function cmdAdd() {
  const title = String(arg("--title", "")).trim();
  if (!title) throw new Error("--title is required");
  const description = String(arg("--description", "")).trim();
  const priority = Math.max(1, Math.min(5, Number(arg("--priority", "3")) || 3));
  const actor = by();

  const board = readBoard();
  const id = mkId();
  board.tasks.push({
    id,
    title,
    description,
    priority,
    status: "To Do",
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by: actor,
    assignee: null,
    requests: [],
    history: [{ at: nowIso(), by: actor, action: "created", detail: "task created" }],
  });
  writeBoard(board);
  console.log(`✅ task added: ${id}`);
}

function findTask(board, id) {
  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

function cmdList() {
  const board = readBoard();
  const grouped = { "To Do": [], "In Progress": [], Blocked: [], Done: [] };
  for (const t of board.tasks) {
    if (!grouped[t.status]) grouped[t.status] = [];
    grouped[t.status].push(t);
  }
  console.log(`board: ${TASKS_JSON}`);
  for (const k of ["To Do", "In Progress", "Blocked", "Done"]) {
    console.log(`\n${k} (${grouped[k].length})`);
    for (const t of grouped[k]) {
      const reqs = Array.isArray(t.requests) ? t.requests.filter((r) => r.status === "open").length : 0;
      console.log(`- ${t.id} | p${t.priority} | ${t.title}${reqs ? ` | open_requests=${reqs}` : ""}`);
    }
  }
}

function cmdMove() {
  const id = String(arg("--id", "")).trim();
  const to = statusNorm(arg("--to", ""));
  const actor = by();
  if (!id) throw new Error("--id is required");

  const board = readBoard();
  const task = findTask(board, id);

  if (to === "Done" && actor !== OWNER) {
    throw new Error(`Only owner can move to Done. owner=${OWNER}, by=${actor}`);
  }

  const from = task.status;
  task.status = to;
  task.updated_at = nowIso();
  task.history = task.history || [];
  task.history.push({ at: nowIso(), by: actor, action: "move", detail: `${from} -> ${to}` });

  if (to === "In Progress") {
    task.assignee = actor;
    const { runDir, updates } = ensureRunFolder(id);
    task.run_path = runDir;
    appendUpdate(id, `Task moved to In Progress.\n\nTitle: ${task.title}`, actor);
    console.log(`✅ moved to In Progress, run folder: ${runDir}`);
    console.log(`updates: ${updates}`);
  } else {
    console.log(`✅ moved ${id}: ${from} -> ${to}`);
  }

  writeBoard(board);
}

function cmdUpdate() {
  const id = String(arg("--id", "")).trim();
  const text = String(arg("--text", "")).trim();
  const actor = by();
  if (!id || !text) throw new Error("--id and --text are required");

  const board = readBoard();
  const task = findTask(board, id);
  const updates = appendUpdate(id, text, actor);
  task.updated_at = nowIso();
  task.history = task.history || [];
  task.history.push({ at: nowIso(), by: actor, action: "update", detail: text.slice(0, 120) });
  writeBoard(board);
  console.log(`✅ update appended: ${updates}`);
}

function cmdMention() {
  const id = String(arg("--id", "")).trim();
  const to = String(arg("--to", "")).trim();
  const text = String(arg("--text", "")).trim();
  const actor = by();
  if (!id || !to || !text) throw new Error("--id, --to, and --text are required");

  const board = readBoard();
  const task = findTask(board, id);
  const req = {
    id: mkId(),
    at: nowIso(),
    from: actor,
    to,
    text,
    status: "open",
  };
  task.requests = task.requests || [];
  task.requests.push(req);
  task.updated_at = nowIso();
  task.history = task.history || [];
  task.history.push({ at: nowIso(), by: actor, action: "mention", detail: `@${to} ${text}` });
  const updates = appendUpdate(id, `@${to} REQUEST: ${text}`, actor);
  writeBoard(board);
  console.log(`✅ mention request created for @${to}`);
  console.log(`request_id: ${req.id}`);
  console.log(`updates: ${updates}`);
}

function main() {
  const cmd = (args()[0] || "").trim().toLowerCase();
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }
  if (cmd === "init") return cmdInit();
  if (cmd === "add") return cmdAdd();
  if (cmd === "list") return cmdList();
  if (cmd === "move") return cmdMove();
  if (cmd === "update") return cmdUpdate();
  if (cmd === "mention") return cmdMention();
  throw new Error(`Unknown command: ${cmd}`);
}

try {
  main();
} catch (err) {
  console.error(`[tasks-kanban] fatal: ${err.message}`);
  process.exit(1);
}

