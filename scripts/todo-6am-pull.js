#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);

function has(flag) {
  return args.includes(flag);
}

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function nowIso() {
  return new Date().toISOString();
}

function dateKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const DRY_RUN = has("--dry-run");
const LIMIT = Math.max(10, Math.min(15, Number(arg("--limit", "12")) || 12));
const SOURCE_PREF = String(arg("--source", "auto")).toLowerCase(); // auto|todoist|things
const TODOIST_TOKEN = String(process.env.TODOIST_API_TOKEN || "").trim();
const THINGS_EXPORT_JSON = String(process.env.THINGS_EXPORT_JSON || "").trim();

const DAILY_DIR = path.join(os.homedir(), "notes", "daily");
const OUT_FILE = path.join(DAILY_DIR, `${dateKey()}_done-while-sleeping.md`);

const SAFE_BLOCKLIST = [
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\brm\b/i,
  /\bremove\b/i,
  /\bpurchase\b/i,
  /\bbuy\b/i,
  /\bpay\b/i,
  /\bwire\b/i,
  /\btransfer\b/i,
  /\bdeploy\b/i,
  /\bproduction\b/i,
  /\blive\b/i,
  /\bmigrate\b/i,
  /\bcredential\b/i,
  /\bsecret\b/i,
  /\boauth\b/i,
  /\bcontract\b/i,
  /\blegal\b/i,
  /\binvoice\b/i,
  /\brefund\b/i,
  /\?$/,
];

function normalizeTask(raw, source) {
  const title = String(raw.content || raw.title || raw.name || "").trim();
  const description = String(raw.description || raw.notes || "").trim();
  const due = raw.due?.date || raw.due || null;
  const priority = Number(raw.priority || 1);
  const id = String(raw.id || raw.uuid || `${source}:${title}`).trim();
  return {
    id,
    source,
    title,
    description,
    due,
    priority,
    raw,
  };
}

function isSafeTask(task) {
  const hay = `${task.title}\n${task.description}`.trim();
  for (const re of SAFE_BLOCKLIST) {
    if (re.test(hay)) return { safe: false, reason: `matches blocked pattern: ${re}` };
  }
  if (!hay) return { safe: false, reason: "empty task text" };
  return { safe: true, reason: "safe_by_heuristic" };
}

async function fetchTodoistTasks() {
  if (!TODOIST_TOKEN) return { enabled: false, reason: "TODOIST_API_TOKEN missing", tasks: [] };
  const url = "https://api.todoist.com/rest/v2/tasks";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
  if (!res.ok) {
    return { enabled: true, reason: `todoist_fetch_failed:${res.status}`, tasks: [] };
  }
  const data = await res.json().catch(() => []);
  const tasks = (Array.isArray(data) ? data : []).map((x) => normalizeTask(x, "todoist"));
  return { enabled: true, reason: null, tasks, source_url: url };
}

function fetchThingsTasks() {
  if (!THINGS_EXPORT_JSON) return { enabled: false, reason: "THINGS_EXPORT_JSON missing", tasks: [] };
  if (!fs.existsSync(THINGS_EXPORT_JSON)) {
    return { enabled: true, reason: `things_export_missing:${THINGS_EXPORT_JSON}`, tasks: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(THINGS_EXPORT_JSON, "utf8"));
    const arr = Array.isArray(data) ? data : (Array.isArray(data.tasks) ? data.tasks : []);
    const tasks = arr
      .filter((x) => !x.completed && !x.canceled)
      .map((x) => normalizeTask(x, "things"));
    return { enabled: true, reason: null, tasks, source_url: THINGS_EXPORT_JSON };
  } catch (err) {
    return { enabled: true, reason: `things_parse_failed:${err.message}`, tasks: [] };
  }
}

function rankTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const p = (b.priority || 0) - (a.priority || 0);
    if (p !== 0) return p;
    const ad = a.due ? Date.parse(a.due) : Number.MAX_SAFE_INTEGER;
    const bd = b.due ? Date.parse(b.due) : Number.MAX_SAFE_INTEGER;
    return ad - bd;
  });
}

async function closeTodoistTask(taskId) {
  const url = `https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(taskId)}/close`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
  return { ok: res.ok, status: res.status, url };
}

async function executeSafeTasks(tasks) {
  const done = [];
  const failed = [];
  const proposals = [];

  for (const task of tasks) {
    const check = isSafeTask(task);
    if (!check.safe) {
      proposals.push({ ...task, proposal_reason: check.reason });
      continue;
    }

    if (task.source === "todoist") {
      if (DRY_RUN) {
        done.push({ ...task, action: "would_close", ok: true });
      } else {
        const r = await closeTodoistTask(task.id);
        if (r.ok) done.push({ ...task, action: "closed", ok: true });
        else failed.push({ ...task, action: "close_failed", ok: false, status: r.status });
      }
    } else {
      proposals.push({ ...task, proposal_reason: "things_integration_read_only" });
    }
  }

  return { done, failed, proposals };
}

function chooseSource(todoist, things) {
  if (SOURCE_PREF === "todoist") return "todoist";
  if (SOURCE_PREF === "things") return "things";
  if (todoist.tasks.length) return "todoist";
  if (things.tasks.length) return "things";
  return "none";
}

function writeReport(payload) {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  const lines = [];
  lines.push("# Done While Sleeping");
  lines.push("");
  lines.push(`- generated_at: ${nowIso()}`);
  lines.push(`- mode: ${DRY_RUN ? "dry-run" : "live"}`);
  lines.push(`- selected_source: ${payload.selectedSource}`);
  lines.push(`- task_limit: ${LIMIT}`);
  lines.push(`- completed_count: ${payload.done.length}`);
  lines.push(`- failed_count: ${payload.failed.length}`);
  lines.push(`- proposal_count: ${payload.proposals.length}`);
  lines.push("");

  lines.push("## Completed");
  if (!payload.done.length) {
    lines.push("- none");
  } else {
    for (const t of payload.done) {
      lines.push(`- [${t.source}] ${t.title} (${t.action})`);
    }
  }
  lines.push("");

  lines.push("## Needs Confirmation (proposal only)");
  if (!payload.proposals.length) {
    lines.push("- none");
  } else {
    for (const t of payload.proposals) {
      lines.push(`- [${t.source}] ${t.title} — ${t.proposal_reason}`);
    }
  }
  lines.push("");

  lines.push("## Failures");
  if (!payload.failed.length) {
    lines.push("- none");
  } else {
    for (const t of payload.failed) {
      lines.push(`- [${t.source}] ${t.title} — ${t.action} status=${t.status || "n/a"}`);
    }
  }
  lines.push("");

  lines.push("## Source Log");
  for (const s of payload.sourceLog) {
    lines.push(`- ${s}`);
  }
  lines.push("");

  fs.writeFileSync(OUT_FILE, lines.join("\n"));
}

async function main() {
  const todoist = await fetchTodoistTasks();
  const things = fetchThingsTasks();
  const selectedSource = chooseSource(todoist, things);
  const sourceLog = [
    `timestamp=${nowIso()}`,
    `todoist_enabled=${todoist.enabled} reason=${todoist.reason || "ok"} source=${todoist.source_url || "n/a"}`,
    `things_enabled=${things.enabled} reason=${things.reason || "ok"} source=${things.source_url || "n/a"}`,
  ];

  let sourceTasks = [];
  if (selectedSource === "todoist") sourceTasks = todoist.tasks;
  if (selectedSource === "things") sourceTasks = things.tasks;
  const selected = rankTasks(sourceTasks).slice(0, LIMIT);

  const { done, failed, proposals } = await executeSafeTasks(selected);
  const payload = { selectedSource, done, failed, proposals, sourceLog };
  writeReport(payload);

  console.log("=== 6am Task Pull ===");
  console.log(`source=${selectedSource}`);
  console.log(`selected=${selected.length} completed=${done.length} failed=${failed.length} proposals=${proposals.length}`);
  console.log(`report=${OUT_FILE}`);
}

main().catch((err) => {
  console.error(`[todo-6am-pull] fatal: ${err.message}`);
  process.exit(1);
});

