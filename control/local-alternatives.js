"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_VERITAP_PATH = "$HOME/claw-repos/veritap_2026";
const DATA_DIR = path.join(__dirname, "../data/local-alternatives");
const EMAIL_OUTBOX = path.join(DATA_DIR, "email-outbox.jsonl");
const SMS_OUTBOX = path.join(DATA_DIR, "sms-outbox.jsonl");
const AI_LOG = path.join(DATA_DIR, "ai-log.jsonl");

const SERVICE_CATALOG = [
  {
    id: "ai",
    envHints: ["AI_INTEGRATIONS_OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"],
    deps: ["openai"],
    current: "OpenAI/OpenRouter APIs",
    localAlternative: "Ollama local model routing",
    coreReplacement: "Use local Ollama for generation + classification + fallback model chain",
    bonus: "Add cost-per-task estimator and prompt replay history",
    monthlyCostRangeUsd: "40-500+",
  },
  {
    id: "email",
    envHints: ["BREVO_API_KEY", "RESEND_API_KEY", "MAILEROO_API_KEY"],
    deps: [],
    current: "Brevo/Resend/Maileroo transactional email",
    localAlternative: "Local outbox + SMTP relay optional",
    coreReplacement: "Queue drafts locally; send manually or via one SMTP relay later",
    bonus: "Auto quality scoring and A/B subject variant generation",
    monthlyCostRangeUsd: "15-150",
  },
  {
    id: "sms",
    envHints: ["TELNYX_API_KEY"],
    deps: [],
    current: "Telnyx messaging",
    localAlternative: "Local SMS queue simulator",
    coreReplacement: "Run campaign simulation and approval gate before any paid send",
    bonus: "Quiet-hour enforcement and opt-out simulation built-in",
    monthlyCostRangeUsd: "20-300+",
  },
  {
    id: "analytics",
    envHints: ["GA4_PROPERTY_ID", "GOOGLE_APPLICATION_CREDENTIALS"],
    deps: ["@google-analytics/data"],
    current: "GA4 Data API",
    localAlternative: "Local event ledger + dashboards",
    coreReplacement: "Store event metrics locally (Postgres/SQLite) and chart trends",
    bonus: "Attribution notes per lead and campaign outcome tagging",
    monthlyCostRangeUsd: "0-100",
  },
  {
    id: "places",
    envHints: ["GOOGLE_PLACES_API_KEY"],
    deps: [],
    current: "Google Places lookup",
    localAlternative: "CSV/imported business directory",
    coreReplacement: "Use local curated lead list + dedupe/scoring pipeline",
    bonus: "Relevance scoring tuned to your verticals",
    monthlyCostRangeUsd: "10-100",
  },
  {
    id: "payments",
    envHints: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    deps: ["stripe"],
    current: "Stripe billing and webhooks",
    localAlternative: "Local invoice + payment simulation",
    coreReplacement: "Simulate checkout/subscriptions while testing product-market fit",
    bonus: "Margin simulator and break-even alerts",
    monthlyCostRangeUsd: "variable + fees",
  },
  {
    id: "wallet_pass",
    envHints: ["APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID"],
    deps: ["passkit-generator"],
    current: "Apple Wallet pass stack",
    localAlternative: "QR pass fallback",
    coreReplacement: "Use QR-based pass artifacts and local update feed",
    bonus: "Cross-platform fallback (Android + printable) in one flow",
    monthlyCostRangeUsd: "99/yr dev + ops",
  },
];

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendJsonl(filePath, payload) {
  ensureDataDir();
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function readJsonl(filePath, limit = 50) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  return lines
    .slice(Math.max(0, lines.length - limit))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

function parseEnvExample(repoPath) {
  const envPath = path.join(repoPath, ".env.example");
  if (!fs.existsSync(envPath)) return [];
  return fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.split("=")[0].trim());
}

function parsePackageDeps(repoPath) {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return [];
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  return Array.from(new Set([...deps, ...devDeps]));
}

function scanVeritapServices(repoPath = DEFAULT_VERITAP_PATH) {
  const envVars = parseEnvExample(repoPath);
  const deps = parsePackageDeps(repoPath);

  const services = SERVICE_CATALOG.map((svc) => {
    const envMatches = svc.envHints.filter((e) => envVars.includes(e));
    const depMatches = svc.deps.filter((d) => deps.includes(d));
    const detected = envMatches.length > 0 || depMatches.length > 0;
    return {
      ...svc,
      detected,
      envMatches,
      depMatches,
      estimatedMonthlySavingsUsd: detected ? svc.monthlyCostRangeUsd : "0",
      status: detected ? "candidate" : "not_used",
    };
  });

  const usedCount = services.filter((s) => s.detected).length;
  return {
    scannedAt: new Date().toISOString(),
    repoPath,
    summary: {
      servicesDetected: usedCount,
      totalCatalogServices: services.length,
      recommendation: usedCount > 0
        ? "Build local pilot modules first: test in shadow mode, keep paid services live, cut over only when proven"
        : "No paid-service signals found from env/deps scan",
    },
    services,
    phasePlan: [
      {
        phase: 1,
        name: "Local pilot mode",
        steps: [
          "Keep existing SaaS active and add local alternatives as test-only lanes",
          "Compare output parity and latency on real tasks",
          "Track reliability, savings, and quality gaps",
        ],
      },
      {
        phase: 2,
        name: "Selective cutover",
        steps: [
          "Switch only proven modules to local default",
          "Keep SaaS as explicit fallback for each module",
          "Add daily health checks + automatic drift alerts",
        ],
      },
      {
        phase: 3,
        name: "Cost optimization",
        steps: [
          "Disable only paid APIs that are no longer needed",
          "Retain only providers needed for regulated edge cases",
          "Archive migration notes and runbook",
        ],
      },
    ],
  };
}

async function runLocalAiPrompt({ prompt, model, maxTokens, timeoutMs, temperature }) {
  const text = (prompt || "").toString().trim();
  if (!text) throw new Error("prompt is required");

  const primaryHost = String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434").trim();
  const hosts = [
    primaryHost,
    ...String(process.env.OLLAMA_HOSTS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  ]
    .map((h) => (/^https?:\/\//i.test(h) ? h.replace(/\/+$/, "") : `http://${h.replace(/\/+$/, "")}`))
    .filter(Boolean);
  const uniqueHosts = [...new Set(hosts)];
  const selectedModel = (model || process.env.OLLAMA_MODEL_FAST || "llama3.1:8b").toString();

  const reqBody = {
    model: selectedModel,
    messages: [{ role: "user", content: text }],
    stream: false,
    options: {
      num_predict: Math.max(64, Math.min(512, Number(maxTokens || 220) || 220)),
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
      top_p: 0.9,
      num_ctx: 4096,
    },
  };

  const started = Date.now();
  let data = null;
  let usedHost = null;
  let lastErr = null;
  for (const host of uniqueHosts) {
    try {
      const resp = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(Math.max(3000, Number(timeoutMs || 12000) || 12000)),
      });
      if (!resp.ok) {
        const raw = await resp.text();
        lastErr = new Error(`ollama_error:${resp.status}:${raw.slice(0, 200)}`);
        continue;
      }
      data = await resp.json();
      usedHost = host;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!data) {
    throw new Error(`ollama_all_hosts_failed:${lastErr?.message || "unknown"}`);
  }

  const output = data?.message?.content || "";
  const log = {
    ts: new Date().toISOString(),
    prompt: text,
    model: selectedModel,
    host: usedHost,
    elapsed_ms: Date.now() - started,
    output_preview: output.slice(0, 500),
  };
  appendJsonl(AI_LOG, log);

  return {
    ok: true,
    model: selectedModel,
    host: usedHost,
    elapsed_ms: log.elapsed_ms,
    output,
  };
}

function createEmailDraft(payload) {
  const row = {
    ts: new Date().toISOString(),
    to: payload.to || "",
    subject: payload.subject || "",
    body: payload.body || "",
    status: "draft",
    source: "local-alternative-lab",
  };
  if (!row.to || !row.subject || !row.body) {
    throw new Error("to, subject, and body are required");
  }
  appendJsonl(EMAIL_OUTBOX, row);
  return row;
}

function createSmsDraft(payload) {
  const row = {
    ts: new Date().toISOString(),
    to: payload.to || "",
    message: payload.message || "",
    status: "draft",
    source: "local-alternative-lab",
  };
  if (!row.to || !row.message) {
    throw new Error("to and message are required");
  }
  appendJsonl(SMS_OUTBOX, row);
  return row;
}

function getRecentActivity(limit = 30) {
  return {
    emailDrafts: readJsonl(EMAIL_OUTBOX, limit),
    smsDrafts: readJsonl(SMS_OUTBOX, limit),
    aiRuns: readJsonl(AI_LOG, limit),
  };
}

module.exports = {
  scanVeritapServices,
  runLocalAiPrompt,
  createEmailDraft,
  createSmsDraft,
  getRecentActivity,
};
