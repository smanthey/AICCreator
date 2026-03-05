#!/usr/bin/env node
// scripts/index-nas-storage.js
// Indexes the NAS Storage share (SMB-mounted at /Volumes/home/Storage)
// into claw.files with source_machine = "nas_primary".
//
// Run manually after mounting NAS:
//   open smb://SMAT:Ducati34$@192.168.1.164/home    # mounts /Volumes/home
//   node scripts/index-nas-storage.js
//
// Or dry-run first:
//   node scripts/index-nas-storage.js --dry-run
//
// The NAS folder structure maps to brands:
//   /Volumes/home/Storage/SMAt designs/   → brand: smat
//   /Volumes/home/Storage/reFramed/       → brand: reframed
//   /Volumes/home/Storage/plushtrap/      → brand: plushtrap
//   /Volumes/home/Storage/wmac masters/   → brand: wmac
//   /Volumes/home/Storage/bws/            → brand: bws
//   ... etc

"use strict";

require("dotenv").config();

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const NAS_ROOT    = process.env.NAS_STORAGE_PATH || "/Volumes/home/Storage";
const SOURCE_NAME = "nas_primary";
const BATCH       = 100;
const DRY_RUN     = process.argv.includes("--dry-run");

const pool = new Pool({
  host:     process.env.CLAW_DB_HOST     || process.env.POSTGRES_HOST     || "192.168.1.164",
  port:     Number(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT  || 15432),
  user:     process.env.CLAW_DB_USER     || process.env.POSTGRES_USER     || "claw",
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  database: process.env.CLAW_DB_NAME || "claw_architect",
  max: 3,
  connectionTimeoutMillis: 20000,
});

// Reuse brand patterns from classify-claw-files.js
const BRAND_PATTERNS = [
  // ── Core brands ──────────────────────────────────────────────────────
  { match: /sweetoz/i,                                    brand: "sweetoz"          },
  { match: /reframed|re[\-_\s]framed/i,                   brand: "reframed"         },
  { match: /plush[\s._-]?trap|plushtrap/i,                brand: "plushtrap"        },
  { match: /wmac[\s._-]masters|wmac[\s\/_]/i,             brand: "wmac"             },
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

function detectBrand(filePath) {
  for (const { match, brand } of BRAND_PATTERNS) {
    if (match.test(filePath)) return brand;
  }
  // Top-level NAS folder = brand
  const rel = filePath.replace(NAS_ROOT, "").replace(/^\//, "");
  const topFolder = rel.split("/")[0].toLowerCase();
  if (topFolder) return topFolder.replace(/\s+/g, "_").slice(0, 30);
  return null;
}

// Skip hidden files, system dirs, and Synology housekeeping
const SKIP_NAMES = new Set(["@eadir", "@syno", ".ds_store", ".localized", "desktop.ini", "thumbs.db"]);
const SKIP_EXTS  = new Set(["tmp", "temp", "part", "crdownload"]);

function shouldSkip(fullPath) {
  const base = path.basename(fullPath).toLowerCase();
  if (base.startsWith(".") && !base.startsWith("..")) return true;
  if (SKIP_NAMES.has(base)) return true;
  const ext = path.extname(base).replace(".", "");
  if (SKIP_EXTS.has(ext)) return true;
  return false;
}

// Fast synthetic hash using path+size+mtime — avoids reading file bytes over SMB.
// Real SHA-256 can be computed in a follow-up dedup pass if needed.
function hashFile(filePath, stat) {
  const key = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  return crypto.createHash("sha256").update(key).digest("hex");
}

const EXT_MIME = {
  jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",
  heic:"image/heic",heif:"image/heif",webp:"image/webp",tiff:"image/tiff",
  psd:"image/vnd.adobe.photoshop",ai:"application/postscript",
  svg:"image/svg+xml",indd:"application/x-indesign",
  mp4:"video/mp4",mov:"video/quicktime",avi:"video/x-msvideo",
  mkv:"video/x-matroska",m4v:"video/x-m4v",
  mp3:"audio/mpeg",aac:"audio/aac",wav:"audio/wav",flac:"audio/flac",m4a:"audio/mp4",
  pdf:"application/pdf",doc:"application/msword",
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt:"application/vnd.ms-powerpoint",
  pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pages:"application/x-iwork-pages-sffpages",numbers:"application/x-iwork-numbers-sffnumbers",
  txt:"text/plain",md:"text/markdown",csv:"text/csv",json:"application/json",
  js:"text/javascript",ts:"text/typescript",py:"text/x-python",
  zip:"application/zip",tar:"application/x-tar",gz:"application/gzip",
  dmg:"application/x-apple-diskimage",pkg:"application/x-newton-compatible-pkg",
  nef:"image/x-nikon-nef",cr2:"image/x-canon-cr2",arw:"image/x-sony-arw",
  dng:"image/x-adobe-dng",raw:"image/x-raw",
};

function getMime(ext) { return EXT_MIME[ext] || "application/octet-stream"; }

function getCategory(mime) {
  if (mime.startsWith("image/"))  return "media";
  if (mime.startsWith("video/"))  return "media";
  if (mime.startsWith("audio/"))  return "media";
  if (mime.includes("pdf") || mime.includes("word") || mime.includes("openxmlformats") ||
      mime.includes("ms-excel") || mime.includes("ms-powerpoint") ||
      mime.includes("iwork"))     return "business_doc";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("gzip") ||
      mime.includes("diskimage")) return "archive";
  if (mime.startsWith("text/"))   return "business_doc";
  return "unknown";
}

let indexed = 0, skipped = 0, errors = 0;
const pending = [];

async function flush(client) {
  for (const row of pending) {
    try {
      await client.query(
        `INSERT INTO files
           (path, filename, size_bytes, sha256, modified_at, source_machine,
            category, category_confidence, category_reason, brand)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (path, filename, source_machine) DO UPDATE SET
           size_bytes          = EXCLUDED.size_bytes,
           sha256              = EXCLUDED.sha256,
           modified_at         = EXCLUDED.modified_at,
           indexed_at          = NOW(),
           category            = EXCLUDED.category,
           category_confidence = EXCLUDED.category_confidence,
           category_reason     = EXCLUDED.category_reason,
           brand               = EXCLUDED.brand`,
        [row.path, row.filename, row.size_bytes, row.sha256, row.modified_at,
         SOURCE_NAME, row.category, row.confidence, row.reason, row.brand]
      );
      indexed++;
    } catch (err) {
      errors++;
      console.error(`  ✗ ${row.filename}: ${err.message}`);
    }
  }
  pending.length = 0;
}

async function walkDir(dir, client) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (err) { console.warn(`  ⚠ Cannot read ${dir}: ${err.message}`); return; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (shouldSkip(fullPath)) { skipped++; continue; }

    if (entry.isDirectory()) {
      await walkDir(fullPath, client);
    } else if (entry.isFile()) {
      try {
        const stat     = fs.statSync(fullPath);
        const sha256   = hashFile(fullPath, stat);
        const ext      = path.extname(entry.name).toLowerCase().replace(".", "");
        const mime     = getMime(ext);
        const category = getCategory(mime);
        const brand    = detectBrand(fullPath);

        pending.push({
          path:       path.dirname(fullPath),
          filename:   entry.name,
          size_bytes: stat.size,
          sha256,
          modified_at: stat.mtime,
          category,
          confidence: 1,
          reason:     `nas_primary: ${category} file (.${ext || "?"})`,
          brand,
        });

        if (pending.length >= BATCH) await flush(client);

        process.stdout.write(`\r  Scanned: ${indexed + pending.length + skipped} files...   `);
      } catch (err) {
        errors++;
        console.warn(`\n  ✗ ${entry.name}: ${err.message}`);
      }
    }
  }
}

async function main() {
  // Check NAS is mounted
  if (!fs.existsSync(NAS_ROOT)) {
    console.error(`\n❌ NAS not mounted at ${NAS_ROOT}`);
    console.error("   Mount it first: open smb://SMAT:Ducati34$@192.168.1.164/home");
    process.exit(1);
  }

  console.log(`\n📂 NAS Storage Indexer`);
  console.log(`   Root:   ${NAS_ROOT}`);
  console.log(`   Source: ${SOURCE_NAME}`);
  console.log(`   Mode:   ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  if (DRY_RUN) {
    // Just count files
    let count = 0;
    function countDir(d) {
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const fp = path.join(d, e.name);
          if (shouldSkip(fp)) continue;
          if (e.isDirectory()) countDir(fp);
          else if (e.isFile()) count++;
        }
      } catch {}
    }
    countDir(NAS_ROOT);
    console.log(`   Would index ~${count.toLocaleString()} files`);
    return;
  }

  const client = await pool.connect();
  try {
    const start = Date.now();
    await walkDir(NAS_ROOT, client);
    await flush(client); // final batch

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n\n✅ Done in ${elapsed}s`);
    console.log(`   Indexed: ${indexed.toLocaleString()} files`);
    console.log(`   Skipped: ${skipped.toLocaleString()} files`);
    console.log(`   Errors:  ${errors}`);

    // Brand summary
    const { rows } = await client.query(
      `SELECT brand, COUNT(*) AS n FROM files WHERE source_machine=$1 AND brand IS NOT NULL
       GROUP BY brand ORDER BY n DESC`,
      [SOURCE_NAME]
    );
    if (rows.length) {
      console.log("\n  Brand breakdown:");
      for (const r of rows) {
        console.log(`    ${r.brand.padEnd(16)} ${parseInt(r.n).toLocaleString()} files`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
