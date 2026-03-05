#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.env.WALLET_REPO_ROOT || '/Users/tatsheen/claw-repos';
const TARGET_REPOS = [
  'SomaveaChaser',
  'CookiesPass',
  'TempeCookiesPass',
  'booked',
  'capture',
  'Inbound-cookies',
  'FoodTruckPass',
];

const REQUIRED_ENV_KEYS = [
  'APPLE_PASS_TYPE_ID',
  'APPLE_TEAM_ID',
  'APPLE_APNS_KEY_ID',
  'APPLE_APNS_KEY_PATH',
  'PASSKIT_AUTH_TOKEN',
];

const ROUTE_PATTERNS = [
  '/v1/devices/.*/registrations/.*/',
  '/v1/devices/.*/registrations/',
  '/v1/passes/.*/',
  '/v1/log',
];

function runRg(repoPath, pattern) {
  const targets = ['server', 'python-backend/app']
    .map((p) => path.join(repoPath, p))
    .filter((p) => fs.existsSync(p));
  if (targets.length === 0) return [];
  const relTargets = targets.map((p) => path.relative(repoPath, p));
  const p = spawnSync('rg', ['-n', '-S', pattern, ...relTargets], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  if (p.status !== 0) return [];
  return p.stdout.trim().split('\n').filter(Boolean);
}

function readEnvKeys(repoPath) {
  const files = ['.env', '.env.local', '.env.example', '.env.test.local', 'python-backend/.env', 'python-backend/.env.example'];
  const found = new Set();
  for (const file of files) {
    const fp = path.join(repoPath, file);
    if (!fs.existsSync(fp)) continue;
    const txt = fs.readFileSync(fp, 'utf8');
    for (const key of REQUIRED_ENV_KEYS) {
      const rx = new RegExp(`^\\s*${key}\\s*=`, 'm');
      if (rx.test(txt)) found.add(key);
    }
  }
  return found;
}

function certStatus(repoPath) {
  const certHints = [
    'server/certs',
    'python-backend/certs',
    'attached_assets',
  ];
  const details = [];
  for (const hint of certHints) {
    const dir = path.join(repoPath, hint);
    if (!fs.existsSync(dir)) continue;
    const p8 = spawnSync('sh', ['-lc', `ls -1 ${JSON.stringify(dir)} | rg -n "\\.p8$|\\.p12$|AuthKey|WWDR|pass\\.cer|pass\\.p12" || true`], { encoding: 'utf8' });
    const lines = p8.stdout.trim().split('\n').filter(Boolean);
    if (lines.length > 0) details.push(`${hint}: ${lines.map((l) => l.replace(/^\d+:/, '')).join(', ')}`);
  }
  return details;
}

function endpointCoverage(repoPath) {
  const hits = [];
  for (const p of ROUTE_PATTERNS) {
    const lines = runRg(repoPath, p);
    if (lines.length) hits.push({ pattern: p, lines });
  }
  return hits;
}

function scoreRepo(envFound, endpointHits, certLines) {
  let score = 0;
  score += Math.min(40, envFound.size * 8);
  score += endpointHits.length >= 5 ? 40 : endpointHits.length * 8;
  score += certLines.length > 0 ? 20 : 0;
  return Math.min(100, score);
}

const rows = [];
for (const repo of TARGET_REPOS) {
  const repoPath = path.join(REPO_ROOT, repo);
  if (!fs.existsSync(repoPath)) {
    rows.push({ repo, missing: true });
    continue;
  }

  const envFound = readEnvKeys(repoPath);
  const endpointHits = endpointCoverage(repoPath);
  const certLines = certStatus(repoPath);

  rows.push({
    repo,
    missing: false,
    score: scoreRepo(envFound, endpointHits, certLines),
    envFound,
    endpointHits,
    certLines,
  });
}

const now = new Date().toISOString();
let md = `# Wallet Repo Env Validation\n\nGenerated: ${now}\nRoot: ${REPO_ROOT}\n\n`;
md += '| Repo | Score | Env Keys | PassKit Route Coverage | Cert Artifacts |\n';
md += '|---|---:|---|---:|---|\n';
for (const r of rows) {
  if (r.missing) {
    md += `| ${r.repo} | 0 | missing repo | 0 | none |\n`;
    continue;
  }
  const envList = REQUIRED_ENV_KEYS.filter((k) => r.envFound.has(k)).join(', ') || 'none';
  md += `| ${r.repo} | ${r.score} | ${envList} | ${r.endpointHits.length} | ${r.certLines.length > 0 ? 'yes' : 'no'} |\n`;
}

md += '\n## Detailed Gaps\n\n';
for (const r of rows) {
  if (r.missing) continue;
  const missingEnv = REQUIRED_ENV_KEYS.filter((k) => !r.envFound.has(k));
  md += `### ${r.repo}\n`;
  md += `- Missing env keys: ${missingEnv.length ? missingEnv.join(', ') : 'none'}\n`;
  md += `- Route hits: ${r.endpointHits.length}\n`;
  if (r.endpointHits.length === 0) md += '- Route gap: no PassKit v1 handlers found\n';
  md += `- Cert hints: ${r.certLines.length ? r.certLines.join(' | ') : 'none found'}\n`;
}

const outDir = path.join(process.cwd(), 'reports');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'wallet-env-validation-latest.md');
fs.writeFileSync(outPath, md, 'utf8');
console.log(md);
console.log(`\nWrote ${outPath}`);
