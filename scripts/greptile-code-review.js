#!/usr/bin/env node
"use strict";

/**
 * Open-source replacement for Greptile integration.
 * Keeps CLI compatibility: --index, --status, --nightly, --query.
 * Uses local repo scanning (ripgrep/git) and writes compatible report artifacts.
 */

require("dotenv").config({ override: true }); // override: true forces .env values to win over stale shell env vars

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(__dirname, "reports");

const mode = process.argv.includes("--index")
  ? "index"
  : process.argv.includes("--status")
    ? "status"
    : process.argv.includes("--nightly")
      ? "nightly"
      : process.argv.includes("--query")
        ? "query"
        : "status";

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function run(cmd, args, cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim(),
  };
}

function defaultRepoFromGit() {
  const r = run("git", ["remote", "get-url", "origin"], ROOT);
  if (!r.ok || !r.stdout) return [];
  const s = r.stdout;
  let m = s.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (m) return [m[1]];
  m = s.match(/gitlab\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (m) return [m[1]];
  return [];
}

async function managedRepos() {
  try {
    const { rows } = await pg.query(
      `SELECT client_name, repo_url, local_path
         FROM managed_repos
        WHERE status='active'
        ORDER BY client_name ASC`
    );
    return rows;
  } catch {
    return [];
  }
}

function repoSlugFromUrl(repoUrl) {
  const s = String(repoUrl || "").trim();
  const m = s.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i) || s.match(/gitlab\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return m ? m[1] : null;
}

async function detectRepos() {
  if (process.env.GREPTILE_REPOS) {
    return process.env.GREPTILE_REPOS.split(",").map((r) => r.trim()).filter(Boolean);
  }

  const repos = await managedRepos();
  const slugs = repos.map((r) => repoSlugFromUrl(r.repo_url)).filter(Boolean);
  if (slugs.length) return [...new Set(slugs)];
  return defaultRepoFromGit();
}

async function resolveLocalPath(repoSlug) {
  const repos = await managedRepos();
  for (const r of repos) {
    const slug = repoSlugFromUrl(r.repo_url);
    if (slug === repoSlug && r.local_path && fs.existsSync(r.local_path)) {
      return r.local_path;
    }
  }

  const name = repoSlug.split("/").pop();
  const candidates = [
    path.join("$HOME/claw-repos", name),
    path.join("$HOME/agentflex", name),
    path.join(ROOT, name),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function patterns() {
  return [
    {
      label: "hardcoded_secret",
      severity: "high",
      rg: "(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|PLAID_SECRET|STRIPE_SECRET_KEY|TELEGRAM_BOT_TOKEN)\\s*[:=]\\s*['\"][^'\"]+['\"]",
      note: "Hardcoded credential-like value detected",
    },
    {
      label: "unsafe_exec",
      severity: "high",
      rg: "child_process\\.(exec|execSync)\\(",
      note: "Potential shell execution surface",
    },
    {
      label: "dangerous_eval",
      severity: "high",
      rg: "\\beval\\s*\\(",
      note: "Use of eval detected",
    },
    {
      label: "todo_fixme",
      severity: "medium",
      rg: "(TODO|FIXME|HACK|XXX)",
      note: "Open code debt markers",
    },
    {
      label: "test_gap_signal",
      severity: "medium",
      rg: "(describe\\(|it\\(|test\\()",
      note: "Test signal density check",
      invert: true,
    },
  ];
}

function grep(repoPath, expr) {
  const r = run("rg", ["-n", "-S", "--hidden", "--glob", "!.git", expr, repoPath], repoPath);
  if (!r.ok && !r.stdout) return [];
  return r.stdout.split("\n").filter(Boolean).slice(0, 200);
}

async function nightlyReview(repos) {
  const out = [];
  for (const repo of repos) {
    const repoPath = await resolveLocalPath(repo);
    if (!repoPath) {
      out.push({
        label: `repo:${repo}`,
        answer: "Local path not found; skipped.",
        severity: "medium",
        findings: [],
      });
      continue;
    }

    const findings = [];
    for (const p of patterns()) {
      const hits = grep(repoPath, p.rg);
      if (p.invert) {
        if (hits.length === 0) {
          findings.push({ severity: p.severity, type: p.label, note: "No obvious tests found in scanned files", sample: [] });
        }
        continue;
      }
      if (hits.length > 0) {
        findings.push({ severity: p.severity, type: p.label, note: p.note, sample: hits.slice(0, 5) });
      }
    }

    const critical = findings.filter((f) => f.severity === "critical").length;
    const high = findings.filter((f) => f.severity === "high").length;
    const medium = findings.filter((f) => f.severity === "medium").length;

    const answer = [
      `repo: ${repo}`,
      `path: ${repoPath}`,
      `critical=${critical} high=${high} medium=${medium}`,
      ...findings.slice(0, 6).map((f) => `- [${f.severity}] ${f.type}: ${f.note}`),
    ].join("\n");

    out.push({ label: repo, answer, findings, repo_path: repoPath, critical, high, medium });
  }
  return out;
}

async function writeNightlyReport(repos, findings) {
  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const outPath = path.join(REPORTS_DIR, `${stamp}-greptile-review.json`);
  const latest = path.join(REPORTS_DIR, "greptile-review-latest.json");

  const all = findings.flatMap((f) => f.findings || []);
  const report = {
    generated_at: new Date().toISOString(),
    engine: "open-source-local-review",
    repos_reviewed: repos,
    critical_count: all.filter((x) => x.severity === "critical").length,
    high_count: all.filter((x) => x.severity === "high").length,
    medium_count: all.filter((x) => x.severity === "medium").length,
    findings,
  };

  await fsp.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  await fsp.writeFile(latest, `${JSON.stringify(report, null, 2)}\n`);
  return { outPath, latest, report };
}

async function indexRepos(repos) {
  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  const status = [];
  for (const repo of repos) {
    const repoPath = await resolveLocalPath(repo);
    status.push({ repo, indexed: !!repoPath, repo_path: repoPath, indexed_at: new Date().toISOString() });
  }
  const file = path.join(REPORTS_DIR, "greptile-index-latest.json");
  await fsp.writeFile(file, `${JSON.stringify({ generated_at: new Date().toISOString(), engine: "open-source-local-review", repos: status }, null, 2)}\n`);
  return status;
}

async function queryRepos(repos, query) {
  const results = [];
  for (const repo of repos) {
    const repoPath = await resolveLocalPath(repo);
    if (!repoPath) continue;
    const hits = grep(repoPath, query).slice(0, 20);
    results.push({ repo, repo_path: repoPath, hit_count: hits.length, hits });
  }
  return results;
}

async function main() {
  const repos = await detectRepos();
  if (!repos.length) {
    console.error("[oss-review] no repos detected. Set GREPTILE_REPOS=owner/repo1,owner/repo2 or configure managed_repos.");
    process.exit(1);
  }

  if (mode === "index") {
    const res = await indexRepos(repos);
    console.log(JSON.stringify({ ok: true, mode, repos: res.length }, null, 2));
    return;
  }

  if (mode === "status") {
    const res = await indexRepos(repos);
    const indexed = res.filter((r) => r.indexed).length;
    console.log(JSON.stringify({ ok: true, mode, repos: res.length, indexed }, null, 2));
    return;
  }

  if (mode === "query") {
    const q = arg("--q", arg("--query-text", ""));
    if (!q) {
      throw new Error("--query requires --q '<pattern>'");
    }
    const res = await queryRepos(repos, q);
    console.log(JSON.stringify({ ok: true, mode, query: q, repos: res }, null, 2));
    return;
  }

  const findings = await nightlyReview(repos);
  const written = await writeNightlyReport(repos, findings);
  console.log(JSON.stringify({
    ok: true,
    mode,
    engine: "open-source-local-review",
    repos_reviewed: repos.length,
    critical: written.report.critical_count,
    high: written.report.high_count,
    report: written.outPath,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("[oss-review] fatal:", err.message || String(err));
      process.exit(1);
    })
    .finally(async () => {
      await pg.end().catch(() => {});
    });
}

module.exports = {
  detectRepos,
  nightlyReview,
};
