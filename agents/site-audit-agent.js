// agents/site-audit-agent.js
// ──────────────────────────────────────────────────────────────────────────
// Uses Ollama (local LLM) to audit, analyze, and standardize web code
// across all indexed scottmanthey sites/projects.
//
// Task types handled:
//   site_audit        — deep analysis of a brand's web files via Ollama
//   site_compare      — compare implementations across brands (find best iteration)
//   site_fix_plan     — generate a fix/standardization plan for a brand
//   site_extract_patterns — extract reusable patterns (auth, billing, SMS, etc.)
//
// Payload examples:
//   { task: "site_audit",    brand: "sweetoz" }
//   { task: "site_compare",  pattern: "auth" }            -- finds best OAuth impl
//   { task: "site_compare",  pattern: "stripe" }          -- best Stripe/metered billing
//   { task: "site_compare",  pattern: "maileroo" }
//   { task: "site_compare",  pattern: "telnyx" }          -- SMS + voice + inbound
//   { task: "site_fix_plan", brand: "gethipd" }
//   { task: "site_extract_patterns", pattern: "auth" }
//
// "use strict";

const path   = require("path");
const fs     = require("fs");
const pg     = require("../infra/postgres");
const { register } = require("./registry");
const { chat, chatJson } = require("../infra/model-router");

const OLLAMA_MODEL = process.env.OLLAMA_CLASSIFY_MODEL || "llama3";

// ── Pattern keywords for code search ─────────────────────────────────────
const PATTERN_KEYWORDS = {
  auth:       ["oauth", "passport", "jwt", "session", "auth", "login", "signup", "callback", "google", "github"],
  betterauth: ["better-auth", "better auth", "betterAuth", "auth handler", "auth route", "session"],
  multi_tenant: ["multi_tenant", "multi-tenant", "tenant", "organization_id", "workspace", "rbac", "rls"],
  stripe:     ["stripe", "payment", "checkout", "subscription", "billing", "webhook", "price_id", "customer"],
  metered:    ["usage", "meter", "metered", "report_usage", "subscribe", "plan", "tier"],
  maileroo:   ["maileroo", "transactional", "smtp", "sendmail", "nodemailer", "email"],
  mailersend: ["mailersend", "mailersend api", "mailer send", "sendgrid", "resend", "transactional email"],
  email_flows:["email flow", "campaign", "drip", "sequence", "automation", "template", "send_email", "scheduler", "webhook"],
  telnyx:     ["telnyx", "sms", "voice", "call", "inbound", "webhook", "phone", "messaging"],
  sms:        ["sms", "twilio", "telnyx", "text", "message", "send_sms"],
  database:   ["pg", "postgres", "sequelize", "prisma", "mongoose", "redis", "supabase"],
  frontend:   ["react", "next", "vue", "nuxt", "svelte", "tailwind", "bootstrap"],
  api:        ["express", "fastify", "hono", "router", "middleware", "cors", "rate"],
};

// ── Web-relevant extensions ───────────────────────────────────────────────
const WEB_EXTS = new Set([
  "js","ts","jsx","tsx","mjs","cjs",
  "html","htm","css","scss","sass","less","vue","svelte",
  "json","env","yaml","yml",
]);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".cache"]);
const MAX_REPO_FILES = 600;

// Approximate token count (rough: 4 chars per token)
function approxTokens(str) { return Math.ceil(str.length / 4); }

async function determineApprovalRequirement({ brand, fix_plan, integrations, file_count }) {
  const system = `You are a senior engineering lead making autonomous execution decisions.
Analyze the fix plan and determine if it can proceed automatically (ASA - as soon as available) or requires human approval.

Decision criteria:
- **Auto-fix safe (ASA)**: Non-breaking changes, config updates, missing integrations, standardization tasks, non-critical files
- **Requires approval**: Breaking changes, production-critical files, database migrations, payment/auth changes, destructive operations, high-risk refactoring

Output JSON with:
{
  "requires_approval": boolean,
  "auto_fix_safe": boolean,
  "reason": "brief explanation of decision",
  "risk_factors": ["list", "of", "identified", "risks"],
  "confidence": 0.0-1.0
}`;

  const user = `Brand: ${brand}
File count: ${file_count}
Integrations detected: ${Object.entries(integrations).map(([k,v]) => `${k}: ${v ? "✅" : "❌"}`).join(", ")}

Fix Plan:
${fix_plan}

Determine if this fix plan can proceed automatically or requires approval.`;

  try {
    const result = await chatJson("site_fix_plan", system, user, { 
      timeout_ms: 60000,
      json_mode: true 
    });

    const decision = result.json || {
      requires_approval: true,
      auto_fix_safe: false,
      reason: "Failed to parse decision - defaulting to approval required for safety",
      risk_factors: ["decision_parse_failed"],
      confidence: 0.0
    };

    // Safety fallback: if confidence is low, require approval
    if (decision.confidence < 0.7) {
      decision.requires_approval = true;
      decision.auto_fix_safe = false;
      decision.reason = `Low confidence (${decision.confidence}) - requiring approval for safety`;
    }

    return decision;
  } catch (err) {
    console.error(`[site-audit-agent] Approval decision failed: ${err.message}`);
    // Default to requiring approval on error
    return {
      requires_approval: true,
      auto_fix_safe: false,
      reason: `Decision failed: ${err.message} - defaulting to approval required`,
      risk_factors: ["decision_error"],
      confidence: 0.0
    };
  }
}

async function safeOllamaChat(taskType, system, user, timeoutMs = 120_000) {
  try {
    const routed = await chat(taskType, system, user, { timeout_ms: timeoutMs });
    return {
      analysis: routed.text || "",
      provider_used: routed.provider_used || routed.provider || "ollama",
      model_used: routed.model_used || routed.model_id || OLLAMA_MODEL,
      confidence: routed.confidence ?? null,
      escalation_reason: routed.escalation_reason || null,
      cost_usd: Number(routed.cost_usd || 0),
      cache_hit: routed.cache_hit === true,
    };
  } catch (err) {
    return {
      analysis: [
        "LLM unavailable during this run.",
        `reason: ${err?.message || String(err)}`,
        "fallback: deterministic scan completed; re-run after model providers are healthy for full narrative output.",
      ].join("\n"),
      provider_used: "none",
      model_used: "none",
      confidence: null,
      escalation_reason: "policy",
      cost_usd: 0,
      cache_hit: false,
    };
  }
}

// ── Read a file safely (truncated) ───────────────────────────────────────
function readFileSafe(filePath, maxChars = 4000) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.length > maxChars
      ? content.slice(0, maxChars) + `\n\n[... truncated at ${maxChars} chars ...]`
      : content;
  } catch { return null; }
}

function walkRepoFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < MAX_REPO_FILES) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).replace(/^\./, "").toLowerCase();
      if (!WEB_EXTS.has(ext)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      out.push({
        path: full,
        filename: e.name,
        ext,
        size_bytes: size,
        source_machine: "repo_scan",
        category: "web_code",
      });
      if (out.length >= MAX_REPO_FILES) break;
    }
  }
  return out;
}

async function getManagedRepo(target) {
  const val = String(target || "").trim();
  if (!val) return null;
  const { rows } = await pg.query(
    `SELECT client_name, local_path
       FROM managed_repos
      WHERE status = 'active'
        AND (LOWER(client_name) = LOWER($1) OR LOWER(repo_url) LIKE '%' || LOWER($1) || '%')
      ORDER BY client_name
      LIMIT 1`,
    [val]
  );
  return rows[0] || null;
}

// ── Get web files for a managed repo ─────────────────────────────────────
async function getFilesForBrand(brandOrRepo) {
  const repo = await getManagedRepo(brandOrRepo);
  if (!repo || !repo.local_path || !fs.existsSync(repo.local_path)) return [];
  const files = walkRepoFiles(repo.local_path);
  return files.map((f) => ({ ...f, brand: repo.client_name }));
}

// ── Search files for keyword patterns ────────────────────────────────────
async function findFilesWithKeywords(keywords, brands = null) {
  const params = [];
  let sql = `SELECT client_name, local_path FROM managed_repos WHERE status='active'`;
  if (brands && brands.length) {
    sql += ` AND LOWER(client_name) = ANY($1::text[])`;
    params.push(brands.map((b) => String(b).toLowerCase()));
  }
  sql += ` ORDER BY client_name`;
  const repos = (await pg.query(sql, params)).rows;

  const rows = [];
  for (const repo of repos) {
    if (!repo.local_path || !fs.existsSync(repo.local_path)) continue;
    const files = walkRepoFiles(repo.local_path);
    for (const f of files) {
      const text = `${f.path} ${f.filename}`.toLowerCase();
      if (keywords.some((k) => text.includes(String(k).toLowerCase()))) {
        rows.push({
          path: f.path,
          filename: f.filename,
          ext: f.ext,
          brand: repo.client_name,
          source_machine: "repo_scan",
        });
        if (rows.length >= 200) return rows;
      }
    }
  }
  return rows;
}

// ── HANDLER: site_audit ───────────────────────────────────────────────────
register("site_audit", async (payload) => {
  const brand = payload.brand || payload.repo;
  if (!brand) throw new Error("site_audit requires brand or repo");

  // 1. Get web files for this brand
  const allFiles = await getFilesForBrand(brand);
  if (allFiles.length === 0) {
    return { brand, error: "No web files indexed for this brand. Run index-github-repos.js first." };
  }

  // 2. Build a file tree summary
  const fileTree = allFiles
    .map(f => `${f.source_machine}:/${f.filename} (${f.ext}, ${Math.round(f.size_bytes/1024)}KB)`)
    .slice(0, 100)
    .join("\n");

  // 3. Sample key files for Ollama analysis
  const keyFiles = allFiles
    .filter(f => ["package.json","index.js","app.js","server.js","_app.js","layout.js",
                  "index.ts","app.ts","server.ts"].includes(f.filename)
              || f.filename.includes("route") || f.filename.includes("auth"))
    .slice(0, 8);

  let codeSnippets = "";
  let totalTokens  = 0;
  for (const f of keyFiles) {
    const content = readFileSafe(f.path, 2000);
    if (!content) continue;
    const tokens = approxTokens(content);
    if (totalTokens + tokens > 6000) break;
    codeSnippets += `\n\n=== ${f.source_machine}:${f.filename} ===\n${content}`;
    totalTokens  += tokens;
  }

  // 4. Ask Ollama
  const system = `You are a senior full-stack web developer auditing client projects.
Be concise and actionable. Use markdown. Focus on: broken patterns, missing integrations,
security issues, outdated deps, and what's working well.`;

  const user = `Audit the "${brand}" project. Here is a summary of its files:

${fileTree}

Key file contents:
${codeSnippets || "(no readable source files found)"}

Provide:
1. **Stack overview** (frameworks, DB, auth, payments, email, SMS)
2. **What's working** (functional patterns worth keeping)
3. **What's broken / incomplete** (specific files or patterns)
4. **Priority fixes** (ordered list, most critical first)
5. **Missing integrations** (auth, Stripe, Maileroo, Telnyx if applicable)
6. **Standardization notes** (vs other sites in the portfolio)`;

  const routed = await safeOllamaChat("site_audit", system, user, 180_000);
  const analysis = routed.analysis;

  // 5. Save to DB
  await pg.query(
    `INSERT INTO qa_results (task_id, test_name, status, summary, details, cost_usd, model_used)
     VALUES (gen_random_uuid(), $1, 'pass', $2, $3, 0, $4)`,
    [`site_audit:${brand}`, analysis.slice(0, 500), JSON.stringify({ brand, file_count: allFiles.length, analysis }), routed.model_used || OLLAMA_MODEL]
  ).catch(() => {}); // non-critical

  return {
    brand,
    file_count:  allFiles.length,
    files_sample: allFiles.slice(0, 20).map(f => ({ file: f.filename, ext: f.ext, machine: f.source_machine })),
    analysis,
    model_used: routed.model_used || OLLAMA_MODEL,
    provider_used: routed.provider_used || "ollama",
    confidence: routed.confidence ?? null,
    escalation_reason: routed.escalation_reason || null,
    cache_hit: routed.cache_hit === true,
    cost_usd: routed.cost_usd || 0,
  };
});

// ── HANDLER: site_compare (find best iteration of a pattern) ─────────────
register("site_compare", async (payload) => {
  const { pattern } = payload;
  if (!pattern) throw new Error("site_compare requires pattern (e.g. 'auth', 'stripe', 'telnyx')");

  const keywords = PATTERN_KEYWORDS[pattern.toLowerCase()]
    || [pattern.toLowerCase()];

  // Find all files mentioning this pattern across all brands
  const files = await findFilesWithKeywords(keywords);

  if (files.length === 0) {
    return { pattern, error: `No files found containing keywords: ${keywords.join(", ")}` };
  }

  // Group by brand
  const byBrand = {};
  for (const f of files) {
    if (!byBrand[f.brand || "unknown"]) byBrand[f.brand || "unknown"] = [];
    byBrand[f.brand || "unknown"].push(f);
  }

  // Read top 3 most promising implementations
  const implementations = [];
  for (const [brand, brandFiles] of Object.entries(byBrand).slice(0, 5)) {
    const topFile = brandFiles[0];
    const content = readFileSafe(topFile.path, 2500);
    if (content) {
      implementations.push({ brand, file: topFile.filename, content });
    }
  }

  const implText = implementations
    .map(i => `=== ${i.brand} / ${i.file} ===\n${i.content}`)
    .join("\n\n");

  const system = `You are a senior engineer reviewing multiple implementations of the same integration
across different client projects. Identify the best implementation and explain why.`;

  const user = `Compare these "${pattern}" implementations across projects and identify the BEST one to use as the standard template.

${implText}

Answer:
1. **Best implementation** (which brand/file and why)
2. **What makes it the best** (specific code patterns, security, completeness)
3. **What to copy from each** (cherry-pick the best parts)
4. **Standard template outline** (what the canonical "${pattern}" integration should look like)
5. **Gaps across all implementations** (what's missing everywhere)`;

  const routed = await safeOllamaChat("site_compare", system, user, 180_000);
  const analysis = routed.analysis;

  return {
    pattern,
    brands_with_pattern: Object.keys(byBrand),
    total_files_found:   files.length,
    implementations_reviewed: implementations.map(i => ({ brand: i.brand, file: i.file })),
    analysis,
    model_used: routed.model_used || OLLAMA_MODEL,
    provider_used: routed.provider_used || "ollama",
    confidence: routed.confidence ?? null,
    escalation_reason: routed.escalation_reason || null,
    cache_hit: routed.cache_hit === true,
    cost_usd: routed.cost_usd || 0,
  };
});

// ── HANDLER: site_fix_plan ────────────────────────────────────────────────
register("site_fix_plan", async (payload) => {
  const brand = payload.brand || payload.repo;
  if (!brand) throw new Error("site_fix_plan requires brand or repo");

  const files = await getFilesForBrand(brand);
  if (files.length === 0) {
    return { brand, error: "No files indexed for this brand." };
  }

  // Check which key integrations exist
  const checks = {
    auth:    ["auth","passport","oauth","jwt","session"],
    stripe:  ["stripe","checkout","subscription"],
    maileroo:["maileroo","nodemailer","smtp","sendmail"],
    telnyx:  ["telnyx","sms","voice","inbound"],
    env:     [".env","dotenv","process.env"],
  };

  const integrations = {};
  for (const [key, kws] of Object.entries(checks)) {
    integrations[key] = files.some(f =>
      kws.some(kw => f.path.toLowerCase().includes(kw) || f.filename.toLowerCase().includes(kw))
    );
  }

  const fileList = files
    .slice(0, 60)
    .map(f => `  ${f.filename} (${f.ext})`)
    .join("\n");

  const system = `You are a senior web developer creating a concrete fix plan for a client project.
Be specific and actionable. Output a markdown fix plan with clear task items.`;

  const user = `Create a fix and standardization plan for the "${brand}" project.

Detected integrations:
${Object.entries(integrations).map(([k,v]) => `  ${k}: ${v ? "✅ found" : "❌ missing"}`).join("\n")}

File inventory (${files.length} total web files):
${fileList}

Generate:
1. **Critical fixes** (broken/missing things that block the site from working)
2. **Auth setup** ${integrations.auth ? "(review + harden)" : "(implement from scratch — use best OAuth pattern)"}
3. **Stripe billing** ${integrations.stripe ? "(review + add metered if missing)" : "(implement Stripe Checkout + metered billing)"}
4. **Email (Maileroo)** ${integrations.maileroo ? "(review templates)" : "(integrate Maileroo transactional email)"}
5. **Telnyx (SMS + voice)** ${integrations.telnyx ? "(review + add inbound webhook)" : "(integrate Telnyx SMS + voice + inbound)"}
6. **Standardization tasks** (align with portfolio conventions)
7. **Estimated effort** per task (hours)`;

  const routed = await safeOllamaChat("site_fix_plan", system, user, 180_000);
  const plan = routed.analysis;

  // ── AI Decision: Auto-fix vs Approval Required ────────────────────────
  const approvalDecision = await determineApprovalRequirement({
    brand,
    fix_plan: plan,
    integrations,
    file_count: files.length,
  });

  return {
    brand,
    file_count:   files.length,
    integrations,
    fix_plan:     plan,
    approval_required: approvalDecision.requires_approval,
    approval_reason: approvalDecision.reason,
    auto_fix_safe: approvalDecision.auto_fix_safe,
    model_used: routed.model_used || OLLAMA_MODEL,
    provider_used: routed.provider_used || "ollama",
    confidence: routed.confidence ?? null,
    escalation_reason: routed.escalation_reason || null,
    cache_hit: routed.cache_hit === true,
    cost_usd: routed.cost_usd || 0,
  };
});

// ── HANDLER: site_extract_patterns ───────────────────────────────────────
register("site_extract_patterns", async (payload) => {
  const { pattern } = payload;
  if (!pattern) throw new Error("site_extract_patterns requires pattern");

  const keywords = PATTERN_KEYWORDS[pattern.toLowerCase()] || [pattern.toLowerCase()];
  const files    = await findFilesWithKeywords(keywords);

  // Read all matching files (limited)
  const samples = [];
  let tokens = 0;
  for (const f of files.slice(0, 20)) {
    const content = readFileSafe(f.path, 1500);
    if (!content || tokens + approxTokens(content) > 8000) continue;
    samples.push({ brand: f.brand, file: f.filename, content });
    tokens += approxTokens(content);
  }

  if (samples.length === 0) {
    return { pattern, error: "No readable files found for this pattern." };
  }

  const codeBlock = samples
    .map(s => `=== ${s.brand} / ${s.file} ===\n${s.content}`)
    .join("\n\n---\n\n");

  const system = `You are extracting reusable code patterns from multiple projects.
Output a clean, production-ready template that represents the best version of this pattern.`;

  const user = `Extract and synthesize the best "${pattern}" implementation from these files:

${codeBlock}

Output:
1. **Canonical template** (complete, production-ready code for the best ${pattern} implementation)
2. **Config variables** (list of env vars needed)
3. **Dependencies** (npm packages required)
4. **Integration checklist** (steps to wire into a new project)
5. **Common mistakes** found across these implementations to avoid`;

  const routed = await safeOllamaChat("site_extract_patterns", system, user, 240_000);
  const result = routed.analysis;

  return {
    pattern,
    files_analyzed: samples.map(s => ({ brand: s.brand, file: s.file })),
    canonical_template: result,
    model_used: routed.model_used || OLLAMA_MODEL,
    provider_used: routed.provider_used || "ollama",
    confidence: routed.confidence ?? null,
    escalation_reason: routed.escalation_reason || null,
    cache_hit: routed.cache_hit === true,
    cost_usd: routed.cost_usd || 0,
  };
});

console.log("[site-audit] ✅ Handlers registered: site_audit, site_compare, site_fix_plan, site_extract_patterns");
