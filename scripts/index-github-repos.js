#!/usr/bin/env node
/**
 * index-github-repos.js
 * ──────────────────────────────────────────────────────────────────────────
 * Indexes all scottmanthey GitHub repos + any local ~/claw, ~/clawdbot,
 * ~/claw-architect repos into claw.files for brand/category analysis.
 *
 * Strategy:
 *  1. Fetch all repos for GITHUB_ORG_OR_USER via GitHub API (or local list)
 *  2. Clone / pull each repo into REPOS_CACHE_DIR
 *  3. Walk every file → INSERT into claw.files with source_machine='github_<slug>'
 *  4. Brand-detect based on repo name and BRAND_PATTERNS
 *  5. Extension-based category tagging (no Ollama at index time — fast pass)
 *
 * Usage:
 *   node scripts/index-github-repos.js                    # all repos
 *   node scripts/index-github-repos.js --repo sweetoz      # one repo
 *   node scripts/index-github-repos.js --local-only        # skip API, local paths only
 *   node scripts/index-github-repos.js --dry-run           # list repos, no DB writes
 *   node scripts/index-github-repos.js --clear             # wipe github_* rows first
 *
 * Env:
 *   GITHUB_TOKEN        personal access token (read:repo is enough)
 *   GITHUB_ORG_OR_USER  defaults to "scottmanthey"
 *   REPOS_CACHE_DIR     where to clone repos  (default: ~/claw-repos)
 *   CLAW_DB_*           connection to claw DB (same as other scripts)
 */

"use strict";

const path      = require("path");
const fs        = require("fs");
const crypto    = require("crypto");
const { spawnSync, execSync } = require("child_process");
const { Pool }  = require("pg");
const https     = require("https");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

// ── Config ────────────────────────────────────────────────────────────────
const GITHUB_USER    = process.env.GITHUB_ORG_OR_USER || "scottmanthey";
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN       || "";
const REPOS_CACHE    = process.env.REPOS_CACHE_DIR
  || path.join(process.env.HOME || "/tmp", "claw-repos");
const DRY_RUN    = process.argv.includes("--dry-run");
const LOCAL_ONLY = process.argv.includes("--local-only");
const CLEAR      = process.argv.includes("--clear");
const ONE_REPO   = (() => {
  const idx = process.argv.indexOf("--repo");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

// Local repo paths that are ALWAYS indexed (regardless of GitHub API)
const LOCAL_REPOS = [
  { slug: "claw",           localPath: path.join(process.env.HOME, "claw")           },
  { slug: "clawdbot",       localPath: path.join(process.env.HOME, "clawdbot")       },
  { slug: "claw-architect", localPath: path.join(process.env.HOME, "claw-architect") },
];

// ── BRAND_PATTERNS (kept in sync with classify-claw-files.js) ────────────
const BRAND_PATTERNS = [
  { match: /sweetoz/i,                                    brand: "sweetoz"          },
  { match: /reframed|re[\-_\s]framed/i,                   brand: "reframed"         },
  { match: /plush[\s._-]?trap|plushtrap/i,                brand: "plushtrap"        },
  { match: /wmac[\s._-]masters|wmac[\s/_]/i,              brand: "wmac"             },
  { match: /cold[\s._-]?az[\s._-]?ice|coldazice/i,        brand: "coldazice"        },
  { match: /bips[\s._-]?topper|bipsrtopper/i,             brand: "bipstopper"       },
  { match: /zit[\s._-]?happens|zithappens/i,              brand: "zithappens"       },
  { match: /smash[\s._-]?wraps|smashwraps/i,              brand: "smashwraps"       },
  { match: /skyn[\s._-]?patch|skynpatch/i,                brand: "skynpatch"        },
  { match: /lemon[\s._-]?tree|lemontree/i,                brand: "lemontree"        },
  { match: /bws[\/_]/i,                                   brand: "bws"              },
  { match: /smat[\s._-]?design|SMAt.designs/i,            brand: "smat"             },
  { match: /\/smat\//i,                                   brand: "smat"             },
  { match: /talyoni/i,                                    brand: "talyoni"          },
  { match: /clawdbot|claw[\-_]architect|\/claw\//i,       brand: "clawdbot"         },
  { match: /\/gethipd\//i,                                brand: "gethipd"          },
  { match: /\/slangboard\/|\/1\.\s*slangboard\//i,        brand: "slangboard"       },
  { match: /\/sticker.?packs?\/|\/3\.\s*sticker\//i,      brand: "sticker_packs"    },
  { match: /\/social.?dashboard\/|\/4\.\s*social\/|\/5\.\s*mobile\//i, brand: "social_dashboard" },
  { match: /\/face.?off\/|\/6\.\s*face\//i,               brand: "face_off"         },
  { match: /\/cryptocoin\/|\/2\.\s*crypto\//i,            brand: "cryptocoin"       },
  { match: /\/rent.?check\/|\/8\.\s*rent\//i,             brand: "rent_check"       },
  { match: /\/7\.\s*shortcut\//i,                         brand: "shortcut_app"     },
  { match: /\/glowtray\//i,                               brand: "glowtray"         },
  { match: /\/glo\//i,                                    brand: "glo"              },
  { match: /\/trapcans\//i,                               brand: "trapcans"         },
  { match: /\/pastiesgang\/|\/pasties.?gang\//i,          brand: "pastiesgang"      },
  { match: /\/truefronto\//i,                             brand: "truefronto"       },
  { match: /\/famous\//i,                                 brand: "famous"           },
  { match: /\/rarewoods\//i,                              brand: "rarewoods"        },
  { match: /\/thenny\//i,                                 brand: "thenny"           },
  { match: /\/chefs?.?choice\//i,                         brand: "chefschoice"      },
  { match: /\/brands\/picnic\/|Tatsheen.*\/picnic\//i,    brand: "picnic"           },
  { match: /\/brands\/draco\/|Tatsheen.*\/draco\//i,      brand: "draco"            },
  { match: /\/sweet.?(and|&).?giggles\//i,                brand: "sweet_giggles"    },
  { match: /\/crass.?wipes\//i,                           brand: "crass_wipes"      },
  { match: /\/killacam\//i,                               brand: "killacam"         },
  { match: /\/lit.?stick\//i,                             brand: "lit_stick"        },
  { match: /\/treeats\/|\/tre.?eats\//i,                  brand: "treeats"          },
  { match: /\/luxup\//i,                                  brand: "luxup"            },
  { match: /\/cannasort\//i,                              brand: "cannasort"        },
  { match: /\/zutd\//i,                                   brand: "zutd"             },
  { match: /\/designer.?gummies\//i,                      brand: "designer_gummies" },
  { match: /\/sweet.?stache\//i,                          brand: "sweet_stache"     },
  { match: /\/day.?dreamers\/|\/liquid.?dreams\//i,       brand: "day_dreamers"     },
  { match: /\/jetlife\//i,                                brand: "jetlife"          },
  { match: /\/brands\/bootleg\//i,                        brand: "bootleg"          },
  { match: /\/sickwidit\//i,                              brand: "sickwidit"        },
  { match: /\/onac\//i,                                   brand: "onac"             },
  { match: /\/bcp.?caps\//i,                              brand: "bcp_caps"         },
  { match: /\/ecostyle\//i,                               brand: "ecostylegel"      },
  { match: /\/thcvarin\//i,                               brand: "thcvarin"         },
  { match: /\/norcalfarms\/|\/norcal.?farms\//i,          brand: "norcalfarms"      },
  { match: /\/mapsac\//i,                                 brand: "mapsac"           },
  { match: /\/ichiban\//i,                                brand: "ichiban_farms"    },
  { match: /\/cbd.?revamp\//i,                            brand: "cbd_revamp"       },
  { match: /\/brands\/labs\/|Tatsheen.*\/labs\//i,        brand: "labs"             },
  { match: /\/kens?.?tko\//i,                             brand: "kens_tko"         },
  { match: /\/ipod.?store\//i,                            brand: "ipod_store"       },
  { match: /\/aloc\//i,                                   brand: "aloc"             },
  { match: /\/cookies\//i,                                brand: "cookies"          },
  { match: /scottmanthey/i,                               brand: "smat"             },
  { match: /\/at.?photo\/|\/at photography\//i,           brand: "at_photography"   },
  { match: /\/astrokids\//i,                              brand: "astrokids"        },
  { match: /\/candy.?school\//i,                          brand: "candy_school"     },
  { match: /\/dd.?hemp\//i,                               brand: "dd_hemp"          },
  { match: /\/heaven.?sins\//i,                           brand: "heaven_sins"      },
  { match: /\/ecoco\//i,                                  brand: "ecoco"            },
  { match: /\/talent.?agency\//i,                         brand: "talent_agency"    },
];

function detectBrand(repoSlug, fullPath) {
  // Check path patterns first
  for (const { match, brand } of BRAND_PATTERNS) {
    if (match.test(fullPath)) return brand;
  }
  // Fall back to repo slug
  for (const { match, brand } of BRAND_PATTERNS) {
    if (match.test(repoSlug)) return brand;
  }
  return repoSlug.replace(/[^a-z0-9]/gi, "_").toLowerCase() || null;
}

// ── Extension → category ─────────────────────────────────────────────────
const EXT_CATEGORY = {
  js: "code", ts: "code", jsx: "code", tsx: "code", mjs: "code", cjs: "code",
  py: "code", rb: "code", go: "code", rs: "code", java: "code", php: "code",
  sh: "code", bash: "code", zsh: "code",
  html: "web", htm: "web", css: "web", scss: "web", sass: "web", less: "web",
  vue: "web", svelte: "web",
  json: "data", yaml: "data", yml: "data", toml: "data", env: "data",
  sql: "data", csv: "data", xml: "data",
  md: "docs", mdx: "docs", txt: "docs", rst: "docs",
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  webp: "image", ico: "image",
  pdf: "document", docx: "document", xlsx: "document",
  mp4: "video", mov: "video", webm: "video",
  mp3: "audio", wav: "audio",
  zip: "archive", tar: "archive", gz: "archive",
};

function getCategory(ext) {
  return EXT_CATEGORY[ext.toLowerCase()] || "other";
}

// ── Synthetic hash (path+size+mtime) — no file reads needed ──────────────
function hashFile(filePath, stat) {
  const key = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ── GitHub API helper ─────────────────────────────────────────────────────
function githubApi(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path:     endpoint,
      headers:  {
        "User-Agent": "claw-indexer/1.0",
        "Accept":     "application/vnd.github+json",
        ...(GITHUB_TOKEN ? { "Authorization": `Bearer ${GITHUB_TOKEN}` } : {}),
      },
    };
    https.get(options, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

/** Fetch all repos for the configured user/org (handles pagination) */
async function fetchAllRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await githubApi(
      `/users/${GITHUB_USER}/repos?per_page=100&page=${page}&sort=updated`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

// ── Git helpers ───────────────────────────────────────────────────────────
function gitCloneOrPull(repoUrl, localDir) {
  if (fs.existsSync(path.join(localDir, ".git"))) {
    const r = spawnSync("git", ["-C", localDir, "pull", "--ff-only", "--quiet"], { encoding: "utf8", timeout: 120_000 });
    return { action: "pull", ok: r.status === 0, stderr: r.stderr };
  } else {
    fs.mkdirSync(localDir, { recursive: true });
    const r = spawnSync("git", ["clone", "--depth=1", "--quiet", repoUrl, localDir], { encoding: "utf8", timeout: 180_000 });
    return { action: "clone", ok: r.status === 0, stderr: r.stderr };
  }
}

// ── File walker ───────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", ".cache",
  "vendor", "__pycache__", ".venv", "venv", ".DS_Store",
]);

function* walkFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// ── DB batch writer ───────────────────────────────────────────────────────
async function upsertBatch(pool, rows) {
  if (rows.length === 0) return;
  // Build multi-row VALUES
  const vals = [];
  const params = [];
  let p = 1;
  for (const r of rows) {
    vals.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9})`);
    params.push(r.path, r.filename, r.ext, r.size_bytes, r.sha256,
                r.source_machine, r.brand, r.category, r.category_confidence, r.category_reason);
    p += 10;
  }
  const sql = `
    INSERT INTO files
      (path, filename, ext, size_bytes, sha256,
       source_machine, brand, category, category_confidence, category_reason)
    VALUES ${vals.join(",")}
    ON CONFLICT (sha256, source_machine)
    DO UPDATE SET
      path               = EXCLUDED.path,
      filename           = EXCLUDED.filename,
      brand              = COALESCE(files.brand, EXCLUDED.brand),
      category           = COALESCE(files.category, EXCLUDED.category),
      indexed_at         = now()
  `;
  await pool.query(sql, params);
}

// ── Index one repo dir ────────────────────────────────────────────────────
async function indexRepo(pool, slug, repoDir) {
  const machine = `github_${slug.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  let count = 0;
  let batch = [];
  const BATCH_SIZE = 200;

  for (const filePath of walkFiles(repoDir)) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    if (!stat.isFile()) continue;

    const filename = path.basename(filePath);
    const ext      = (path.extname(filename).replace(/^\./, "") || "").toLowerCase();
    const sha256   = hashFile(filePath, stat);
    const brand    = detectBrand(slug, filePath);
    const category = getCategory(ext);

    batch.push({
      path:               filePath,
      filename,
      ext,
      size_bytes:         stat.size,
      sha256,
      source_machine:     machine,
      brand,
      category,
      category_confidence: 0.6,
      category_reason:    `ext:${ext}`,
    });

    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) await upsertBatch(pool, batch);
      count += batch.length;
      batch = [];
      process.stdout.write(`\r   [${slug}] ${count} files indexed...`);
    }
  }
  if (batch.length > 0) {
    if (!DRY_RUN) await upsertBatch(pool, batch);
    count += batch.length;
  }
  return count;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log(` GitHub Repo Indexer  [user: ${GITHUB_USER}]${DRY_RUN ? "  DRY RUN" : ""}`);
  console.log("══════════════════════════════════════════════════════\n");

  fs.mkdirSync(REPOS_CACHE, { recursive: true });

  const pool = new Pool({
    host:     process.env.CLAW_DB_HOST      || "192.168.1.164",
    port:     parseInt(process.env.CLAW_DB_PORT || "15432"),
    user:     process.env.POSTGRES_USER     || "claw",
    password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
    database: process.env.CLAW_DB_NAME || "claw_architect",
  });

  // ── Optionally wipe existing github_* rows ────────────────────────────
  if (CLEAR && !DRY_RUN) {
    console.log("🗑️  Clearing existing github_* rows...");
    const { rowCount } = await pool.query(
      `DELETE FROM files WHERE source_machine LIKE 'github_%'`
    );
    console.log(`   Removed ${rowCount} rows\n`);
  }

  // ── Build repo list ───────────────────────────────────────────────────
  let githubRepos = [];
  if (!LOCAL_ONLY) {
    if (!GITHUB_TOKEN) {
      console.warn("⚠️  No GITHUB_TOKEN set — API rate limit is 60/hr. Add to .env for full access.\n");
    }
    try {
      console.log(`🔗 Fetching repo list from GitHub API for @${GITHUB_USER}...`);
      githubRepos = await fetchAllRepos();
      console.log(`   Found ${githubRepos.length} repos\n`);
    } catch (e) {
      console.error(`   GitHub API error: ${e.message}`);
      console.log("   Continuing with local repos only.\n");
    }
  }

  // Merge: github API repos + always-indexed local repos
  const repoMap = new Map();

  // Local repos first
  for (const r of LOCAL_REPOS) {
    if (fs.existsSync(r.localPath)) {
      repoMap.set(r.slug, { slug: r.slug, localPath: r.localPath, cloneUrl: null });
    }
  }

  // GitHub repos
  for (const r of githubRepos) {
    if (ONE_REPO && r.name !== ONE_REPO) continue;
    const localDir = path.join(REPOS_CACHE, r.name);
    const cloneUrl = GITHUB_TOKEN
      ? r.clone_url.replace("https://", `https://${GITHUB_TOKEN}@`)
      : r.clone_url;
    repoMap.set(r.name, {
      slug:      r.name,
      localPath: localDir,
      cloneUrl,
      private:   r.private,
      updatedAt: r.updated_at,
      language:  r.language,
    });
  }

  if (ONE_REPO && !repoMap.has(ONE_REPO)) {
    // Single repo mode — use cache path even if not in API list
    repoMap.set(ONE_REPO, {
      slug:      ONE_REPO,
      localPath: path.join(REPOS_CACHE, ONE_REPO),
      cloneUrl:  `https://github.com/${GITHUB_USER}/${ONE_REPO}.git`,
    });
  }

  const repos = [...repoMap.values()];
  console.log(`📦 Processing ${repos.length} repos total\n`);

  if (DRY_RUN) {
    repos.forEach(r => console.log(`   [DRY] ${r.slug.padEnd(40)} ${r.localPath}`));
    await pool.end();
    return;
  }

  // ── Clone / pull + index ────────────────────────────────────────────
  let totalFiles = 0;
  let totalRepos = 0;

  for (const repo of repos) {
    console.log(`\n▶ ${repo.slug}`);

    // Clone or pull if we have a URL
    if (repo.cloneUrl && !fs.existsSync(path.join(repo.localPath, ".git"))) {
      process.stdout.write(`  ⬇  Cloning...`);
      const r = gitCloneOrPull(repo.cloneUrl, repo.localPath);
      console.log(r.ok ? " done" : ` FAILED: ${r.stderr.slice(0, 120)}`);
      if (!r.ok) continue;
    } else if (fs.existsSync(path.join(repo.localPath, ".git"))) {
      process.stdout.write(`  🔄 Pulling...`);
      const r = gitCloneOrPull(null, repo.localPath);
      console.log(r.ok ? " done" : ` (${r.stderr.slice(0, 80)})`);
    } else if (!fs.existsSync(repo.localPath)) {
      console.log(`  ⚠️  Path not found, skipping: ${repo.localPath}`);
      continue;
    }

    // Index files
    process.stdout.write(`  📁 Indexing files...`);
    const count = await indexRepo(pool, repo.slug, repo.localPath);
    console.log(`\r  ✅ ${count.toLocaleString()} files indexed`);
    totalFiles += count;
    totalRepos++;
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const { rows: [summary] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE source_machine LIKE 'github_%') AS github_total,
      COUNT(DISTINCT source_machine) FILTER (WHERE source_machine LIKE 'github_%') AS repo_count,
      COUNT(*) FILTER (WHERE source_machine LIKE 'github_%' AND brand IS NOT NULL) AS branded
    FROM files
  `);

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`✅ Indexed ${totalFiles.toLocaleString()} files across ${totalRepos} repos`);
  console.log(`   DB total (github_*): ${Number(summary.github_total).toLocaleString()} files across ${summary.repo_count} repos`);
  console.log(`   Branded: ${Number(summary.branded).toLocaleString()}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
