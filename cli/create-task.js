const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { validateStatus } = require("../schemas/task");
const { validatePayload } = require("../schemas/payloads");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function createTask(type, payload) {
  if (!isKnownTaskType(type)) {
    throw new Error(`Unknown task type: "${type}"`);
  }
  await ensureRoutingColumns();
  const id = uuidv4();
  const status = "CREATED";
  const routing = resolveRouting(type);
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});

  validateStatus(status);
  validatePayload(type, payload);

  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, type, payload, status, routing.queue, routing.required_tags, idempotencyKey]
  );

  console.log("Task created:", id);
}

function parseArgs(argv) {
  const out = { type: null, payloadRaw: null, help: false };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--type") {
      out.type = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--payload") {
      out.payloadRaw = argv[i + 1] || null;
      i += 1;
      continue;
    }
    positionals.push(arg);
  }

  if (!out.type && positionals.length > 0) out.type = positionals[0];
  if (!out.payloadRaw && positionals.length > 1) out.payloadRaw = positionals[1];
  return out;
}

(async () => {
  const { type, payloadRaw, help } = parseArgs(process.argv.slice(2));
  let payload = {};
  if (payloadRaw) {
    try {
      payload = JSON.parse(payloadRaw);
    } catch (err) {
      console.error(`Invalid JSON payload: ${err.message}`);
      process.exit(1);
    }
  }

  if (help) {
    console.log("Usage: node cli/create-task.js --type <type> [--payload '<json_payload>']");
    console.log("   or: node cli/create-task.js <type> '<json_payload>'");
    process.exit(0);
  }

  if (!type || String(type).startsWith("-")) {
    console.error("Usage: node cli/create-task.js --type <type> [--payload '<json_payload>']");
    console.error("   or: node cli/create-task.js <type> '<json_payload>'");
    process.exit(1);
  }

  await createTask(type, payload);
  process.exit(0);
})().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
