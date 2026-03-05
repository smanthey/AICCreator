#!/usr/bin/env node
"use strict";

/**
 * repo-completion-benchmark-lookup.js
 * Read gap report(s) and emit a markdown report with GitHub search URLs and best-case refs
 * to find repos to benchmark and fill gaps. Run after repo:completion:gap.
 * Usage: node scripts/repo-completion-benchmark-lookup.js --repo CookiesPass
 *        node scripts/repo-completion-benchmark-lookup.js --rolling
 *        node scripts/repo-completion-benchmark-lookup.js --file reports/repo-completion-gap-CookiesPass-*.json
 */

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const ROLLING_PATH = path.join(REPORTS_DIR, "repo-completion-gap-rolling.json");
const OUT_MD = path.join(REPORTS_DIR, "repo-completion-benchmark-lookup-latest.md");

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return String(process.argv[i + 1] || "").trim() || fallback;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function latestGapFileForRepo(repoName) {
  const base = `repo-completion-gap-${repoName}-`;
  let best = null;
  let bestTime = "";
  try {
    const files = fs.readdirSync(REPORTS_DIR);
    for (const f of files) {
      if (f.startsWith(base) && f.endsWith(".json") && f.length > base.length) {
        const stamp = f.slice(base.length, -5);
        if (stamp > bestTime) {
          bestTime = stamp;
          best = path.join(REPORTS_DIR, f);
        }
      }
    }
  } catch {
    // ignore
  }
  return best;
}

function loadGapRecord(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [data];
}

const SECTION_TO_BEST_CASE_KEY = {
  email_setup: "email_delivery",
  admin_setup: "admin_ui",
  auth: "auth",
  stripe_checkout: "stripe_webhooks",
  stripe_webhooks: "stripe_webhooks",
  feature_benchmark_vs_exemplar: "feature_benchmark",
  capability_factory_health: "capability_factory",
};

function ensureBenchmarkLookup(record) {
  if (record.benchmark_lookup && Object.keys(record.benchmark_lookup).length > 0) {
    return record;
  }
  const sections = record.sections || {};
  const bestCaseRef = record.best_case_ref || {};
  const lookup = {};
  const SECTION_GITHUB_QUERIES = {
    email_setup: "resend email verification webhook OR maileroo",
    admin_setup: "multitenant organization_id nextjs OR tenant resolver",
    auth: "better-auth",
    stripe_checkout: "stripe checkout session",
    stripe_webhooks: "stripe webhook signature verification idempotency",
    telnyx_sms: "telnyx sms webhook",
    webhooks_signature_verify: "webhook signature verification",
    queue_retry: "bullmq retry queue worker",
    observability: "observability logging metrics audit",
    e2e: "playwright e2e test OR cypress",
    security_sweep: "security audit dependency",
    capability_factory_health: "stripe webhook auth capability",
    feature_benchmark_vs_exemplar: "feature benchmark exemplar",
  };
  for (const [sectionId, info] of Object.entries(sections)) {
    if (info.status === "complete") continue;
    const q = SECTION_GITHUB_QUERIES[sectionId] || sectionId.replace(/_/g, " ");
    const refKey = SECTION_TO_BEST_CASE_KEY[sectionId] || sectionId;
    lookup[sectionId] = {
      status: info.status,
      detail: info.detail,
      best_case_ref: bestCaseRef[refKey] || bestCaseRef.admin_ui || bestCaseRef.capability_factory || "",
      github_search_query: q,
      github_search_url: `https://github.com/search?type=repositories&q=${encodeURIComponent(q)}`,
    };
  }
  record.benchmark_lookup = lookup;
  return record;
}

function markdownForRecord(record, index, total) {
  const lines = [];
  const repo = record.repo || "unknown";
  const score = record.capability_score ?? "—";
  lines.push(`## ${repo} (score=${score})${total > 1 ? ` [${index + 1}/${total}]` : ""}`);
  lines.push("");
  const incomplete = Object.entries(record.sections || {}).filter(([, v]) => v.status !== "complete");
  if (incomplete.length) {
    lines.push("**Sections to complete:** " + incomplete.map(([k, v]) => `${k}=${v.status}`).join(", ") + "\n");
    lines.push("**Next actions:**");
    for (const a of record.next_actions || []) {
      lines.push(`- ${a}`);
    }
    lines.push("");
    lines.push("### Benchmark lookup (find repos on GitHub to fill gaps)");
    lines.push("");
    const lookup = record.benchmark_lookup || {};
    for (const [sectionId, lu] of Object.entries(lookup)) {
      lines.push(`- **${sectionId}** (${lu.status})`);
      lines.push(`  - [GitHub search: \`${lu.github_search_query}\`](${lu.github_search_url})`);
      if (lu.best_case_ref) {
        lines.push(`  - Best-case ref: ${lu.best_case_ref}`);
      }
      lines.push("");
    }
  } else {
    lines.push("No incomplete sections.\n");
  }
  return lines.join("\n");
}

function main() {
  const repoArg = getArg("--repo", null);
  const fileArg = getArg("--file", null);
  const useRolling = hasArg("--rolling");

  let records = [];
  if (fileArg) {
    const resolved = path.isAbsolute(fileArg) ? fileArg : path.join(ROOT, fileArg);
    if (!fs.existsSync(resolved)) {
      console.error("File not found:", resolved);
      process.exit(2);
    }
    records = loadGapRecord(resolved);
  } else if (repoArg) {
    const fp = latestGapFileForRepo(repoArg);
    if (!fp) {
      console.error("No gap report found for repo:", repoArg);
      process.exit(2);
    }
    records = loadGapRecord(fp);
  } else if (useRolling) {
    if (!fs.existsSync(ROLLING_PATH)) {
      console.error("Rolling report not found:", ROLLING_PATH);
      process.exit(2);
    }
    records = loadGapRecord(ROLLING_PATH);
    // Use last N = number of unique repos so we have one record per repo (latest run)
    const byRepo = new Map();
    for (const r of records) {
      byRepo.set(r.repo, r);
    }
    records = Array.from(byRepo.values()).sort((a, b) => (a.repo || "").localeCompare(b.repo || ""));
  } else {
    console.error("Usage: node scripts/repo-completion-benchmark-lookup.js --repo <name> | --rolling | --file <path>");
    process.exit(2);
  }

  records = records.map((r) => ensureBenchmarkLookup(r));
  const total = records.length;

  const mdLines = [
    "# Repo completion – benchmark lookup",
    "",
    "Use the GitHub search links below to find repos to benchmark and fill gaps. Best-case refs point to local exemplars or docs.",
    "",
    `Generated: ${new Date().toISOString()} (${total} repo(s))`,
    "",
    "---",
    "",
  ];

  records.forEach((record, index) => {
    mdLines.push(markdownForRecord(record, index, total));
    mdLines.push("");
  });

  mdLines.push("---");
  mdLines.push("");
  mdLines.push("**How to use:** Run `npm run repo:completion:gap -- --repo <name>` then `npm run repo:benchmark:lookup -- --repo <name>`. Or run `--rolling` to generate this from the rolling report.");

  const out = mdLines.join("\n");
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(OUT_MD, out);
  console.log("Wrote", OUT_MD);
}

main();
