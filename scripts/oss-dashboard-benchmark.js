#!/usr/bin/env node
"use strict";
/**
 * oss-dashboard-benchmark
 * -----------------------
 * Curated benchmark of high-signal OSS dashboard/chat products.
 * We intentionally score product signal over raw stars so framework-only repos don't dominate.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const CANDIDATES = [
  "open-webui/open-webui",
  "danny-avila/LibreChat",
  "lobehub/lobehub",
  "langgenius/dify",
  "FlowiseAI/Flowise",
  "Mintplex-Labs/anything-llm",
  "langflow-ai/langflow",
  "BerriAI/litellm",
  "langfuse/langfuse",
  "OpenHands/OpenHands",
  "huggingface/chat-ui",
  "casibase/casibase",
];

function fetchRepo(fullName, token) {
  const url = `https://api.github.com/repos/${fullName}`;
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "claw-architect-oss-benchmark/1.0",
      Accept: "application/vnd.github+json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    https.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub ${res.statusCode} ${fullName}`));
        try {
          const j = JSON.parse(body);
          resolve({
            full_name: j.full_name,
            html_url: j.html_url,
            description: j.description || "",
            stars: Number(j.stargazers_count || 0),
            forks: Number(j.forks_count || 0),
            pushed_at: j.pushed_at || null,
            language: j.language || null,
            topics: Array.isArray(j.topics) ? j.topics : [],
            archived: !!j.archived,
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function scoreRepo(repo, maxStars) {
  const text = `${repo.full_name} ${repo.description} ${repo.topics.join(" ")}`.toLowerCase();
  const uiTerms = ["dashboard", "chat", "chatbot", "webui", "admin", "self-hosted", "ui"];
  const modelTerms = ["openai", "anthropic", "gemini", "deepseek", "mcp", "ollama", "multi"];

  const uiHits = uiTerms.filter((t) => text.includes(t));
  const modelHits = modelTerms.filter((t) => text.includes(t));

  const pushedMs = Date.parse(repo.pushed_at || 0);
  const ageDays = Number.isFinite(pushedMs) ? Math.max(0, (Date.now() - pushedMs) / 86400000) : 9999;
  const recency = Math.max(0, 100 - Math.min(100, ageDays / 3));
  const pop = maxStars > 0 ? (repo.stars / maxStars) * 100 : 0;

  // Penalize infra/framework repos unless they show strong operator-facing UI evidence.
  const frameworkOnly = /(sdk|library|framework|toolkit)/i.test(text) && uiHits.length < 2;
  const score = Math.max(0,
    pop * 0.34 +
    recency * 0.18 +
    uiHits.length * 11 +
    modelHits.length * 8 -
    (frameworkOnly ? 35 : 0)
  );

  return {
    ...repo,
    benchmark_score: Math.round(score * 100) / 100,
    ui_hits: uiHits,
    model_hits: modelHits,
    framework_only: frameworkOnly,
  };
}

function toMarkdown(rows) {
  const lines = [
    "# OSS Dashboard/Chat Benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Rank | Repo | Score | Stars | UI Signals | Model Signals |",
    "|---:|---|---:|---:|---|---|",
  ];
  rows.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.full_name} | ${r.benchmark_score} | ${r.stars} | ${r.ui_hits.join(", ") || "-"} | ${r.model_hits.join(", ") || "-"} |`);
  });
  return `${lines.join("\n")}\n`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const outJson = path.join(__dirname, "..", "reports", "oss-dashboard-benchmark-latest.json");
  const outMd = path.join(__dirname, "..", "reports", "oss-dashboard-benchmark-latest.md");
  fs.mkdirSync(path.dirname(outJson), { recursive: true });

  const fetched = [];
  const failed = [];
  for (const repo of CANDIDATES) {
    try {
      fetched.push(await fetchRepo(repo, token));
    } catch (err) {
      failed.push({ repo, error: err.message });
    }
  }

  const maxStars = Math.max(...fetched.map((r) => r.stars), 1);
  const ranked = fetched.map((r) => scoreRepo(r, maxStars)).filter((r) => !r.archived).sort((a, b) => b.benchmark_score - a.benchmark_score);

  const payload = {
    generated_at: new Date().toISOString(),
    candidates: CANDIDATES.length,
    indexed: fetched.length,
    failed,
    ranking: ranked,
    top_recommended: ranked.slice(0, 6).map((r) => ({ full_name: r.full_name, benchmark_score: r.benchmark_score, stars: r.stars })),
  };

  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));
  fs.writeFileSync(outMd, toMarkdown(ranked));

  console.log(`OSS benchmark complete:`);
  console.log(`- ${outJson}`);
  console.log(`- ${outMd}`);
  console.log(`Top: ${payload.top_recommended.map((x) => `${x.full_name} (${x.benchmark_score})`).join(", ")}`);
}

main().catch((err) => {
  console.error(`oss-dashboard-benchmark failed: ${err.message}`);
  process.exit(1);
});
