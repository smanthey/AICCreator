#!/usr/bin/env node
/**
 * Add the Skyn Patch wholesale order page to the Skyn Patch website repo.
 * Uses the git repo system: syncs repo (clone/pull), adds a static wholesale
 * page that POSTs to the checkout API, commits and pushes to a branch.
 *
 * Run by an agent or manually:
 *   node scripts/skynpatch-website-add-wholesale.js [--dry-run] [--no-push]
 *
 * Env:
 *   SKYNPATCH_WEBSITE_REPO_PATH — path to website repo (default: from launch-e2e-targets skynpatch.repo)
 *   SKYNPATCH_WHOLESALE_CHECKOUT_URL — base URL of checkout API (e.g. https://checkout.skynpatch.com)
 *   REPOS_BASE_PATH — fallback base for repo path
 *   GITHUB_TOKEN — for push (HTTPS)
 *
 * By default commits and pushes to the current branch (e.g. main) so Vercel auto-deploys.
 * Use --branch NAME to commit and push to a feature branch instead.
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SKU_KEYS = ["zzzzz", "ignite", "longevity", "synergy", "pre_party", "lust", "grace"];

function git(args, cwd, timeoutMs = 60000) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: timeoutMs });
  return { ok: (r.status || 0) === 0, code: r.status || 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

function getRepoPath() {
  if (process.env.SKYNPATCH_WEBSITE_REPO_PATH) return process.env.SKYNPATCH_WEBSITE_REPO_PATH;
  const targetsPath = path.join(ROOT, "config", "launch-e2e-targets.json");
  if (fs.existsSync(targetsPath)) {
    const arr = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    const skyn = arr.find((t) => (t.name || "").toLowerCase() === "skynpatch");
    if (skyn && skyn.repo) return skyn.repo;
  }
  const base = process.env.REPOS_BASE_PATH || path.join(process.env.HOME || "/tmp", "claw-repos");
  return path.join(base, "v0-skyn-patch");
}

function loadProducts() {
  const fp = path.join(ROOT, ".stripe-products.json");
  if (!fs.existsSync(fp)) return SKU_KEYS.map((k) => ({ key: k, name: k, amount: 25000 }));
  const data = JSON.parse(fs.readFileSync(fp, "utf8"));
  return SKU_KEYS.map((key) => ({
    key,
    name: (data[key] && data[key].name) || key,
    amount: (data[key] && data[key].amount) || 25000,
  }));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildWholesaleHtml(checkoutBaseUrl, products) {
  const rows = products
    .map(
      (p) =>
        `<tr><td><label for="q-${p.key}">${escapeHtml(p.name)}</label></td><td><input type="number" id="q-${p.key}" name="${p.key}" min="0" max="50" value="0" style="width:4em"></td><td>$${(p.amount / 100).toFixed(0)}/case</td></tr>`
    )
    .join("");
  const checkoutUrl = checkoutBaseUrl.replace(/\/$/, "") + "/checkout";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wholesale — SkynPatch</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #ffffff;
      --fg: hsl(222.2 84% 4.9%);
      --muted: hsl(215.4 16.3% 46.9%);
      --border: hsl(214.3 31.8% 91.4%);
      --input: hsl(214.3 31.8% 91.4%);
      --radius: 0.5rem;
      --pink: #ec4899;
      --pink-hover: #db2777;
      --blue: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    @media (min-width: 640px) { body { font-size: 16px; } }
    .site-header {
      position: sticky;
      top: 0;
      z-index: 50;
      width: 100%;
      background: rgba(0,0,0,0.9);
      backdrop-filter: blur(8px);
    }
    .site-header-inner {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 1rem;
      height: 4rem;
      display: flex;
      align-items: center;
    }
    .site-logo {
      font-size: 1.25rem;
      font-weight: 700;
      text-decoration: none;
      color: inherit;
    }
    .site-logo .skyn { color: var(--blue); }
    .site-logo .patch { color: var(--pink); }
    @media (min-width: 768px) { .site-logo { font-size: 1.5rem; } }
    main {
      flex: 1;
      max-width: 640px;
      margin: 0 auto;
      padding: 2rem 1rem 4rem;
      width: 100%;
    }
    @media (min-width: 640px) { main { padding: 3rem 1.5rem 4rem; } }
    @media (min-width: 1024px) { main { padding: 4rem 2rem 5rem; } }
    h1 {
      font-size: 1.5rem;
      line-height: 1.25;
      font-weight: 700;
      margin: 0 0 0.5rem;
    }
    @media (min-width: 640px) { h1 { font-size: 1.875rem; } }
    @media (min-width: 768px) { h1 { font-size: 2.25rem; } }
    .subtitle {
      font-size: 0.875rem;
      color: var(--muted);
      margin: 0 0 1.5rem;
      line-height: 1.5;
    }
    .form-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      background: var(--bg);
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem 0.5rem; text-align: left; border-bottom: 1px solid var(--border); vertical-align: middle; }
    th {
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }
    td label { font-size: 0.875rem; font-weight: 500; display: block; margin-bottom: 0.25rem; }
    @media (min-width: 640px) { td label { font-size: 1rem; } }
    input[type=number] {
      width: 4.5rem;
      font-size: 16px;
      min-height: 44px;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--input);
      border-radius: var(--radius);
      background: var(--bg);
      color: var(--fg);
    }
    input[type=number]:focus {
      outline: none;
      border-color: var(--pink);
      box-shadow: 0 0 0 2px rgba(236, 72, 153, 0.2);
    }
    .shipping-preview {
      font-size: 0.875rem;
      color: var(--muted);
      margin: 1rem 0 1.25rem;
    }
    .btn-checkout {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0.625rem 1.5rem;
      font-size: 1rem;
      font-weight: 600;
      font-family: inherit;
      color: #fff;
      background: var(--pink);
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .btn-checkout:hover:not(:disabled) { background: var(--pink-hover); }
    .btn-checkout:disabled { opacity: 0.5; cursor: not-allowed; }
    .site-footer {
      background: #000;
      color: #fff;
      padding: 2rem 1rem;
      margin-top: auto;
    }
    .site-footer-inner {
      max-width: 1280px;
      margin: 0 auto;
      text-align: center;
    }
    .site-footer a {
      color: #9ca3af;
      text-decoration: none;
      font-size: 0.875rem;
    }
    .site-footer a:hover { color: var(--pink); }
    .site-footer .brand { font-weight: 700; background: linear-gradient(to right, var(--pink), #f97316); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="site-logo"><span class="skyn">Skyn</span><span class="patch">Patch</span></a>
    </div>
  </header>
  <main>
    <h1>Wholesale Order</h1>
    <p class="subtitle">~58% margin · Set quantity per SKU (0 = skip). Shipping is auto-calculated: $5 first case + $1 each additional.</p>
    <form id="form">
      <div class="form-card">
        <table>
          <thead><tr><th>Product</th><th>Qty (cases)</th><th>Price</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="shipping-preview" id="shipping-preview">Shipping: —</p>
        <button type="submit" id="btn" class="btn-checkout">Proceed to Checkout</button>
      </div>
    </form>
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <a href="/" class="brand">SkynPatch</a>
      <span style="color:#6b7280;margin:0 0.5rem;">·</span>
      <a href="/shop">Shop</a>
    </div>
  </footer>
  <script>
    var CHECKOUT_URL = ${JSON.stringify(checkoutUrl)};
    var SKU_KEYS = ${JSON.stringify(SKU_KEYS)};
    var form = document.getElementById('form');
    var btn = document.getElementById('btn');
    var preview = document.getElementById('shipping-preview');
    function totalCases() {
      var n = 0;
      for (var i = 0; i < SKU_KEYS.length; i++) {
        var el = document.getElementById('q-' + SKU_KEYS[i]);
        n += parseInt(el ? el.value : 0, 10) || 0;
      }
      return n;
    }
    function shippingCents(cases) {
      if (cases < 1) return 0;
      return 500 + (cases - 1) * 100;
    }
    function updatePreview() {
      var cases = totalCases();
      var cents = shippingCents(cases);
      preview.textContent = cases < 1 ? 'Shipping: — (add at least 1 case)' : 'Shipping: $' + (cents/100).toFixed(0) + ' (auto)';
      btn.disabled = cases < 1;
    }
    SKU_KEYS.forEach(function(k) {
      var el = document.getElementById('q-' + k);
      if (el) el.addEventListener('change', updatePreview);
    });
    updatePreview();
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      btn.disabled = true;
      var body = {};
      SKU_KEYS.forEach(function(k) {
        var el = document.getElementById('q-' + k);
        body[k] = parseInt(el ? el.value : 0, 10) || 0;
      });
      fetch(CHECKOUT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.url) window.location = d.url;
          else { alert(d.error || 'Checkout failed'); btn.disabled = false; }
        })
        .catch(function(err) { alert(err.message); btn.disabled = false; });
    });
  </script>
</body>
</html>`;
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const noPush = process.argv.includes("--no-push");
  const branchOverride = arg("--branch", null);
  const checkoutUrl = process.env.SKYNPATCH_WHOLESALE_CHECKOUT_URL;
  if (!checkoutUrl) {
    console.error("SKYNPATCH_WHOLESALE_CHECKOUT_URL is required (base URL of checkout API).");
    process.exitCode = 1;
    return;
  }

  const repoPath = getRepoPath();
  console.log("Repo path:", repoPath);

  if (!fs.existsSync(repoPath)) {
    console.error("Repo directory does not exist:", repoPath);
    console.error("Clone the Skyn Patch website repo there or set SKYNPATCH_WEBSITE_REPO_PATH.");
    process.exitCode = 1;
    return;
  }

  const g = (args) => git(args, repoPath);
  if (!g(["rev-parse", "--is-inside-work-tree"]).ok) {
    console.error("Not a git repo:", repoPath);
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    g(["fetch", "origin", "--prune"]);
    const pullResult = g(["pull", "--rebase"]);
    if (!pullResult.ok && pullResult.stderr && !pullResult.stderr.includes("Already up to date")) {
      console.warn("Pull had issues:", pullResult.stderr);
    }
  }

  const products = loadProducts();
  const html = buildWholesaleHtml(checkoutUrl, products);

  const publicDir = path.join(repoPath, "public");
  const outPath = fs.existsSync(publicDir)
    ? path.join(publicDir, "wholesale.html")
    : path.join(repoPath, "wholesale.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  console.log("Wrote:", outPath);

  const status = g(["status", "--porcelain"]);
  if (!status.stdout.trim()) {
    console.log("No changes (file may already exist with same content).");
    return;
  }

  let branch = g(["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
  if (branchOverride) {
    const exists = g(["rev-parse", "--verify", branchOverride]).ok;
    if (exists) {
      const co = g(["checkout", branchOverride]);
      if (!co.ok) {
        console.error("Could not checkout branch:", branchOverride, co.stderr);
        process.exitCode = 1;
        return;
      }
      branch = branchOverride;
    } else {
      const create = g(["checkout", "-b", branchOverride]);
      if (!create.ok) {
        console.error("Could not create branch:", branchOverride, create.stderr);
        process.exitCode = 1;
        return;
      }
      branch = branchOverride;
    }
  }

  if (dryRun) {
    console.log("[dry-run] Would commit and push to", branch);
    return;
  }

  g(["add", path.relative(repoPath, outPath)]);
  const commit = g(["commit", "-m", "Add wholesale order page (auto-calculated shipping, 7 SKUs)"]);
  if (!commit.ok) {
    console.error("Commit failed:", commit.stderr);
    process.exitCode = 1;
    return;
  }

  if (!noPush) {
    const push = g(["push", "-u", "origin", branch], repoPath, 120000);
    if (!push.ok) {
      console.error("Push failed:", push.stderr);
      console.error("Ensure GITHUB_TOKEN is set for HTTPS or SSH keys for push.");
      process.exitCode = 1;
      return;
    }
    console.log("Pushed to origin/" + branch + " — Vercel should auto-deploy.");
  } else {
    console.log("Skipped push (--no-push). Branch:", branch);
  }
}

main();
