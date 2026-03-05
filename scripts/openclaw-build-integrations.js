#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VENV = path.join(ROOT, ".venv-openclaw-tools");
const VENV_BIN = path.join(VENV, "bin");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const REPORT_PATH = path.join(REPORT_DIR, "openclaw-build-integrations-latest.json");

function sh(cmd, opts = {}) {
  const r = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return {
    ok: r.status === 0,
    code: r.status ?? 1,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
    cmd,
  };
}

function findPython() {
  const candidates = ["python3.12", "python3.11", "python3.10", "python3"];
  for (const bin of candidates) {
    const r = sh(`command -v ${bin}`);
    if (r.ok) return bin;
  }
  return null;
}

function install() {
  const py = findPython();
  if (!py) throw new Error("Python 3.10+ is required but not found.");

  const steps = [];
  steps.push(sh(`${py} -m venv "${VENV}"`));
  steps.push(sh(`source "${VENV_BIN}/activate" && python -m pip install -U pip setuptools wheel`));
  steps.push(sh(`source "${VENV_BIN}/activate" && python -m pip install git+https://github.com/jgravelle/jcodemunch-mcp.git`));
  steps.push(sh(`source "${VENV_BIN}/activate" && python -m pip install repo-mapper`));
  steps.push(sh(`source "${VENV_BIN}/activate" && python -m pip install opencv-python-headless pgvector`));

  return { python: py, steps };
}

function verify() {
  const results = {};
  results.jcodemunch_help = sh(`"${VENV_BIN}/jcodemunch-mcp" --help`);
  results.repo_mapper_help = sh(`source "${VENV_BIN}/activate" && python -m repo_mapper --help`);
  results.python_imports = sh(
    `source "${VENV_BIN}/activate" && python - <<'PY'
import importlib, json
mods=["cv2","pgvector","repo_mapper"]
out={}
for m in mods:
  try:
    importlib.import_module(m)
    out[m]="ok"
  except Exception as e:
    out[m]=f"error: {e}"
print(json.dumps(out))
PY`
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repomapper-smoke-"));
  const readme = path.join(tmp, "README.md");
  fs.writeFileSync(readme, "# Smoke\n\n");
  results.repo_mapper_smoke = sh(
    `source "${VENV_BIN}/activate" && python -m repo_mapper "${ROOT}" "${readme}" --use-gitignore --ignore-dirs node_modules .git .next`,
    { env: { PYTHONWARNINGS: "ignore" } }
  );
  results.repo_mapper_smoke_output = fs.readFileSync(readme, "utf8").slice(0, 1200);
  fs.rmSync(tmp, { recursive: true, force: true });

  // Postgres vector extension check (best effort)
  results.pgvector_extension = sh(
    `node - <<'NODE'
const pg = require("./infra/postgres");
(async () => {
  try {
    const before = await pg.query("SELECT extname FROM pg_extension WHERE extname='vector'");
    if (before.rows.length === 0) {
      try { await pg.query("CREATE EXTENSION IF NOT EXISTS vector"); } catch {}
    }
    const after = await pg.query("SELECT extname FROM pg_extension WHERE extname='vector'");
    console.log(JSON.stringify({ vector_extension_installed: after.rows.length > 0 }));
  } catch (e) {
    console.log(JSON.stringify({ vector_extension_installed: false, error: e.message }));
  } finally {
    await pg.end().catch(() => {});
  }
})();
NODE`
  );

  results.jcodemunch_api_syntax = sh(`node --check scripts/jcodemunch-api.js`);
  results.doc_symbol_index = sh(`node scripts/generate-doc-symbol-index.js`);

  return results;
}

function summarize(ok, payload) {
  return {
    ok,
    generated_at: new Date().toISOString(),
    payload,
  };
}

function main() {
  const mode = process.argv[2] || "verify";
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  if (!["install", "verify", "install-verify"].includes(mode)) {
    throw new Error("Usage: node scripts/openclaw-build-integrations.js [install|verify|install-verify]");
  }

  const out = { mode };
  if (mode === "install" || mode === "install-verify") {
    out.install = install();
  }
  if (mode === "verify" || mode === "install-verify") {
    out.verify = verify();
  }

  const checks = [];
  if (out.install?.steps) checks.push(...out.install.steps.map((s) => s.ok));
  if (out.verify) {
    for (const v of Object.values(out.verify)) {
      if (v && typeof v === "object" && "ok" in v) checks.push(!!v.ok);
    }
  }
  const ok = checks.every(Boolean);

  const report = summarize(ok, out);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok, mode, report: REPORT_PATH }, null, 2));
  if (!ok) process.exit(1);
}

main();

