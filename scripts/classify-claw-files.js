#!/usr/bin/env node
// scripts/classify-claw-files.js
// Fast path-based classifier for the claw.files table.
//
// Classifies every file that has category IS NULL, across all source_machines.
// Uses deterministic path + extension rules (no LLM, runs in seconds for 100k files).
// Also detects brand from path — populates the brand column.
//
// Usage:
//   node scripts/classify-claw-files.js
//   node scripts/classify-claw-files.js --machine m4_local
//   node scripts/classify-claw-files.js --all          (re-classify everything)
//   node scripts/classify-claw-files.js --dry-run      (print stats, no writes)
//
// Env: uses CLAW_DB_* vars (or falls back to POSTGRES_*) from .env

"use strict";

require("dotenv").config();

const { Pool } = require("pg");
const path      = require("path");

// ── CLI args ──────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const MACHINE   = args.includes("--machine") ? args[args.indexOf("--machine") + 1] : null;
const RECLASSIFY = args.includes("--all");
const DRY_RUN   = args.includes("--dry-run");
const BATCH     = 500;

const dbHost = process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST;
const dbPort = Number(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || 15432);
const dbUser = process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw";
const dbPass = process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD;
const dbName = process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect";

if (!dbHost || !dbPass) {
  throw new Error("Missing DB env vars. Set CLAW_DB_* or POSTGRES_* including password.");
}

const pool = new Pool({
  host:     dbHost,
  port:     dbPort,
  user:     dbUser,
  password: dbPass,
  database: dbName,
  max: 5,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 10000,
});

// ── BRAND DETECTION ───────────────────────────────────────────────
// Maps lowercased path fragment → canonical brand name.
// Order matters — check more specific patterns first.
const BRAND_PATTERNS = [
  // ── Core brands ──────────────────────────────────────────────────────
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
  // ── Apps portfolio ───────────────────────────────────────────────────
  { match: /\/gethipd\//i,                                brand: "gethipd"          },
  { match: /\/slangboard\/|\/1\.\s*slangboard\//i,        brand: "slangboard"       },
  { match: /\/sticker.?packs?\/|\/3\.\s*sticker\//i,      brand: "sticker_packs"    },
  { match: /\/social.?dashboard\/|\/4\.\s*social\/|\/5\.\s*mobile\//i, brand: "social_dashboard" },
  { match: /\/face.?off\/|\/6\.\s*face\//i,               brand: "face_off"         },
  { match: /\/cryptocoin\/|\/2\.\s*crypto\//i,            brand: "cryptocoin"       },
  { match: /\/rent.?check\/|\/8\.\s*rent\//i,             brand: "rent_check"       },
  { match: /\/7\.\s*shortcut\//i,                         brand: "shortcut_app"     },
  // ── Design brands (glowtray before glo to avoid false match) ─────────
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
  // ── aloc ────────────────────────────────────────────────────────────
  { match: /\/aloc\//i,                                   brand: "aloc"             },
  // ── Cookies wallet passes (two separate dispensary locations) ────────
  // Canonical live mapping:
  // - "CookiesPass ... copy" -> cookies
  // - other "CookiesPass"    -> nirvana
  { match: /CookiesPass.*copy|cookies.*tempe|tempe.*cookies/i, brand: "cookies"   },
  { match: /CookiesPass/i,                                     brand: "nirvana"   },
  { match: /\/cookies\//i,                                     brand: "cookies"   },
  // ── 3D Game Art Academy (website client) ────────────────────────────
  { match: /3DGameArtAcademy|3d.?game.?art.?academy/i,   brand: "3dgameartacademy" },
  // ── Ariel (3D / design work — blender assets, 3D projects) ──────────
  { match: /blenderkit_data|\/ariel\//i,                  brand: "ariel"            },
  // ── scottmanthey GitHub repos ────────────────────────────────────────
  { match: /scottmanthey/i,                               brand: "smat"             },
  // ── Photography / Shoots ────────────────────────────────────────────
  { match: /\/at.?photo\/|\/at photography\//i,           brand: "at_photography"   },
  { match: /\/astrokids\//i,                              brand: "astrokids"        },
  { match: /\/candy.?school\//i,                          brand: "candy_school"     },
  { match: /\/dd.?hemp\//i,                               brand: "dd_hemp"          },
  { match: /\/heaven.?sins\//i,                           brand: "heaven_sins"      },
  { match: /\/ecoco\//i,                                  brand: "ecoco"            },
  { match: /\/talent.?agency\//i,                         brand: "talent_agency"    },
];

function detectBrand(fullPath) {
  for (const { match, brand } of BRAND_PATTERNS) {
    if (match.test(fullPath)) return brand;
  }
  return null;
}

// ── CATEGORY RULES ────────────────────────────────────────────────
// Returns { category, confidence, reason }
// Rules checked in order — first match wins.

const MEDIA_EXT = new Set([
  "jpg","jpeg","png","gif","heic","heif","tiff","tif","bmp","webp",
  "raw","cr2","nef","arw","orf","sr2","dng",        // photos
  "psd","psb","ai","svg","indd","xd","sketch","fig","afdesign",  // design
  "mp4","mov","avi","mkv","m4v","wmv","flv","webm","3gp","mts",  // video
  "mp3","aac","wav","flac","m4a","ogg","wma","aiff","opus",       // audio
]);

const DOC_EXT = new Set([
  "pdf","doc","docx","xls","xlsx","ppt","pptx",
  "numbers","pages","key","csv","rtf","odt","ods",
]);

const CODE_EXT = new Set([
  "js","ts","jsx","tsx","mjs","cjs",
  "py","rb","go","java","swift","kotlin","cpp","c","h","cs","php","rs",
  "html","htm","css","scss","sass","less","vue","svelte",
  "sh","bash","zsh","fish","ps1",
  "sql","graphql","proto",
  "tf","hcl",  // terraform
]);

const ARCHIVE_EXT = new Set([
  "zip","tar","gz","bz2","xz","7z","rar","dmg","pkg","iso","deb","rpm",
]);

const CONFIG_EXT = new Set([
  "json","yaml","yml","toml","ini","env","cfg","conf","config",
  "plist","lock","mod","sum","gemspec",
]);

// Path fragments that indicate non-business personal storage
const PERSONAL_PATHS = [
  "/pictures/", "/photos/", "/photo booth/",
  "/downloads/", "/desktop/", "/documents/",
  "/music/", "/movies/", "/tv/",
  "/garageband/", "/imovie",
];

// Path fragments that definitively indicate app infrastructure
const APP_DATA_PATHS = [
  "/library/application support/", "/library/containers/",
  "/library/caches/", "/library/preferences/",
  "/.config/", "/node_modules/", "/site-packages/",
  "/extensions/", "/frameworks/python", "/python.framework/",
  "/.codex/", "/blenderkit_data/", "/.ollama/",
  "/application data/", "/appdata/",
  "/.cursor/", "/.vscode/",
  "/chrome apps", "chrome apps.localized",
];

// Path fragments that indicate cache / temp files
const CACHE_PATHS = [
  "/.cache/", "/caches/", "/cache/",
  "/tmp/", "/temp/", "/.tmp/",
  "/__pycache__/", "/.pytest_cache/",
  "/derived data/",
];

function classify(filePath, filename) {
  const p    = (filePath + "/" + filename).toLowerCase();
  const ext  = path.extname(filename).toLowerCase().replace(".", "");
  const base = filename.toLowerCase();

  // ── 1. Cache / temp ──────────────────────────────────────────────
  if (CACHE_PATHS.some(s => p.includes(s))) {
    return { category: "cache", confidence: 1, reason: "path indicates browser/app cache" };
  }
  if (ext === "lock" || base.endsWith(".tmp") || base.endsWith(".temp") ||
      base.startsWith(".") && (base.endsWith("sqlite-shm") || base.endsWith("sqlite-wal"))) {
    return { category: "cache", confidence: 1, reason: "lock/temp file extension" };
  }

  // ── 2. App data / system ─────────────────────────────────────────
  if (APP_DATA_PATHS.some(s => p.includes(s))) {
    return { category: "app_data", confidence: 1, reason: "path indicates Application Support" };
  }

  // ── 3. Archive ───────────────────────────────────────────────────
  if (ARCHIVE_EXT.has(ext)) {
    return { category: "archive", confidence: 1, reason: `archive file (.${ext})` };
  }

  // ── 4. Media (photo/video/audio/design) ──────────────────────────
  if (MEDIA_EXT.has(ext)) {
    const isDesign = ["psd","psb","ai","svg","indd","xd","sketch","fig","afdesign"].includes(ext);
    return {
      category:   "media",
      confidence: 1,
      reason:     isDesign ? `design asset (.${ext})` : `media file (.${ext})`,
    };
  }

  // ── 5. Business document ─────────────────────────────────────────
  if (DOC_EXT.has(ext)) {
    // Check if in a personal or app folder
    if (APP_DATA_PATHS.some(s => p.includes(s))) {
      return { category: "app_data", confidence: 1, reason: "document in app support path" };
    }
    return {
      category:   "business_doc",
      confidence: PERSONAL_PATHS.some(s => p.includes(s)) ? 0.7 : 0.95,
      reason:     `document file (.${ext})`,
    };
  }

  // ── 6. Code ──────────────────────────────────────────────────────
  if (CODE_EXT.has(ext)) {
    if (APP_DATA_PATHS.some(s => p.includes(s))) {
      return { category: "app_data", confidence: 1, reason: "code file in app support path" };
    }
    return { category: "business_doc", confidence: 0.9, reason: `code file (.${ext})` };
  }

  // ── 7. Config files ──────────────────────────────────────────────
  if (CONFIG_EXT.has(ext)) {
    if (APP_DATA_PATHS.some(s => p.includes(s))) {
      return { category: "app_data", confidence: 1, reason: "config file in app support" };
    }
    return { category: "config", confidence: 0.9, reason: `config file (.${ext})` };
  }

  // ── 8. Personal (photos/downloads with no doc ext) ───────────────
  if (PERSONAL_PATHS.some(s => p.includes(s))) {
    return { category: "personal_doc", confidence: 0.6, reason: "file in personal folder" };
  }

  // ── 9. Unknown ───────────────────────────────────────────────────
  return { category: "unknown", confidence: 0.5, reason: `unrecognised extension (.${ext || "none"})` };
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  console.log("✅ Connected to claw DB");

  try {
    // Count pending
    const machineFilter = MACHINE ? `AND source_machine = '${MACHINE}'` : "";
    const whereClause   = RECLASSIFY
      ? `WHERE 1=1 ${machineFilter}`
      : `WHERE category IS NULL ${machineFilter}`;

    const { rows: [{ n }] } = await client.query(
      `SELECT COUNT(*) AS n FROM files ${whereClause}`
    );
    const total = parseInt(n);
    console.log(`\n📂 ${total.toLocaleString()} files to classify${MACHINE ? ` (machine: ${MACHINE})` : ""}${DRY_RUN ? " [DRY RUN]" : ""}`);

    if (total === 0) { console.log("Nothing to do — all files already classified."); return; }
    if (DRY_RUN)     { console.log("Dry run — skipping writes."); return; }

    // Process in batches
    let offset  = 0;
    let updated = 0;
    const tally = {};

    while (offset < total) {
      const { rows } = await client.query(
        `SELECT id, path, filename FROM files ${whereClause}
         ORDER BY id LIMIT $1 OFFSET $2`,
        [BATCH, offset]
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        const { category, confidence, reason } = classify(row.path, row.filename);
        const brand = detectBrand(row.path + "/" + row.filename);

        await client.query(
          `UPDATE files
           SET category = $1, category_confidence = $2, category_reason = $3, brand = $4
           WHERE id = $5`,
          [category, confidence, reason, brand, row.id]
        );

        updated++;
        tally[category] = (tally[category] || 0) + 1;
      }

      const pct = Math.round((offset + rows.length) / total * 100);
      process.stdout.write(`\r  Progress: ${(offset + rows.length).toLocaleString()} / ${total.toLocaleString()} (${pct}%)   `);
      offset += BATCH;
    }

    console.log(`\n\n✅ Classified ${updated.toLocaleString()} files\n`);
    console.log("Category breakdown:");
    for (const [cat, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat.padEnd(14)} ${count.toLocaleString()}`);
    }

    // Brand summary
    const { rows: brandRows } = await client.query(
      `SELECT brand, COUNT(*) AS n FROM files
       WHERE brand IS NOT NULL ${machineFilter}
       GROUP BY brand ORDER BY n DESC`
    );
    if (brandRows.length > 0) {
      console.log("\nBrand attribution:");
      for (const r of brandRows) {
        console.log(`  ${r.brand.padEnd(14)} ${parseInt(r.n).toLocaleString()} files`);
      }
    }

    // Final stats per machine
    console.log("\nPer-machine status:");
    const { rows: machineRows } = await client.query(
      `SELECT source_machine,
         COUNT(*) AS total,
         SUM(CASE WHEN category IS NOT NULL THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN category IS NULL THEN 1 ELSE 0 END) AS pending
       FROM files GROUP BY source_machine ORDER BY total DESC`
    );
    for (const r of machineRows) {
      const pct = Math.round(parseInt(r.done) / parseInt(r.total) * 100);
      console.log(`  ${r.source_machine.padEnd(16)} ${parseInt(r.total).toLocaleString().padStart(7)} files  ${pct}% classified  (${parseInt(r.pending).toLocaleString()} pending)`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
