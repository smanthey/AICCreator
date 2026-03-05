"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function usageAndExit() {
  console.error(
    [
      "Usage:",
      "  node scripts/brand-image-catalog.js --targets <comma-separated urls/domains/handles>",
      "",
      "Example:",
      "  node scripts/brand-image-catalog.js --targets examplebrand.com,skynpatch.com,libidopatch.com,smatdesigns.com,zithappens.com,@examplebrand,@ksynpatch",
    ].join("\n")
  );
  process.exit(1);
}

function safeSlug(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeTarget(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function expandTarget(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  if (raw.startsWith("@")) {
    const handle = raw.slice(1);
    return [`https://x.com/${handle}`, `https://www.instagram.com/${handle}/`];
  }
  const normalized = normalizeTarget(raw);
  return normalized ? [normalized] : [];
}

function inferBrandFromHostOrPath(urlStr) {
  const v = String(urlStr || "").toLowerCase();
  if (v.includes("plushtrap") || v.includes("plushtrapper")) return "plushtrap";
  if (v.includes("skynpatch") || v.includes("ksynpatch")) return "skynpatch";
  if (v.includes("libidopatch")) return "libidopatch";
  if (v.includes("smatdesigns") || v.includes("smat")) return "smatdesigns";
  if (v.includes("zithappens")) return "zithappens";
  return "unknown";
}

function inferSku(text) {
  const s = String(text || "");
  const m1 = s.match(/\b([A-Z]{2,}[-_ ]?\d{2,}[A-Z0-9-]*)\b/);
  if (m1) return m1[1].replace(/[_ ]+/g, "-");
  const m2 = s.match(/\b([A-Z0-9]{6,})\b/);
  if (m2) return m2[1];
  const m3 = s.match(/[?&](sku|variant|product|id)=([^&#]+)/i);
  if (m3) return decodeURIComponent(m3[2]).slice(0, 48);
  return "";
}

function inferStyle(text) {
  const s = String(text || "").toLowerCase();
  const map = [
    ["patch", "patch"],
    ["plush", "plush"],
    ["sticker", "sticker"],
    ["hoodie", "hoodie"],
    ["shirt", "shirt"],
    ["tee", "tee"],
    ["hat", "hat"],
    ["cap", "cap"],
    ["mug", "mug"],
    ["poster", "poster"],
    ["3d", "3d"],
    ["render", "3d"],
    ["jacket", "jacket"],
    ["sweatshirt", "sweatshirt"],
  ];
  for (const [k, v] of map) {
    if (s.includes(k)) return v;
  }
  return "unknown";
}

function nearestColorName(r, g, b) {
  const palette = [
    { n: "black", rgb: [0, 0, 0] },
    { n: "white", rgb: [255, 255, 255] },
    { n: "gray", rgb: [128, 128, 128] },
    { n: "red", rgb: [220, 20, 60] },
    { n: "orange", rgb: [255, 140, 0] },
    { n: "yellow", rgb: [240, 220, 60] },
    { n: "green", rgb: [40, 150, 70] },
    { n: "blue", rgb: [30, 100, 220] },
    { n: "purple", rgb: [128, 0, 128] },
    { n: "pink", rgb: [255, 105, 180] },
    { n: "brown", rgb: [120, 72, 40] },
  ];
  let best = palette[0];
  let min = Number.POSITIVE_INFINITY;
  for (const p of palette) {
    const d =
      (r - p.rgb[0]) * (r - p.rgb[0]) +
      (g - p.rgb[1]) * (g - p.rgb[1]) +
      (b - p.rgb[2]) * (b - p.rgb[2]);
    if (d < min) {
      min = d;
      best = p;
    }
  }
  return best.n;
}

function rgbToHex(r, g, b) {
  const p = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

function dominantColorForFile(filePath) {
  return new Promise((resolve) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-i", filePath, "-vf", "scale=1:1,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1"],
      { timeout: 30000, encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout || stdout.length < 3) {
          return resolve({ hex: "", name: "unknown", r: null, g: null, b: null });
        }
        const r = stdout[0];
        const g = stdout[1];
        const b = stdout[2];
        resolve({
          hex: rgbToHex(r, g, b),
          name: nearestColorName(r, g, b),
          r,
          g,
          b,
        });
      }
    );
  });
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const targetsArg =
    getArg("--targets", "") ||
    "examplebrand.com,skynpatch.com,libidopatch.com,smatdesigns.com,zithappens.com,@examplebrand,@ksynpatch";
  const maxPages = Math.max(1, Math.min(80, Number(getArg("--max-pages", "20")) || 20));
  const maxImagesPerPage = Math.max(1, Math.min(250, Number(getArg("--max-images-per-page", "80")) || 80));
  const waitMs = Math.max(100, Math.min(5000, Number(getArg("--wait-ms", "700")) || 700));
  const noDownload = hasFlag("--no-download");

  const targets = [...new Set(targetsArg.split(",").flatMap((v) => expandTarget(v)))];

  if (!targets.length) usageAndExit();

  const { chromium } = require("playwright");
  const runId = nowStamp();
  const outBase = path.join(os.homedir(), "notes", "brand-image-catalog", runId);
  const rawBase = path.join(outBase, "raw");
  fs.mkdirSync(rawBase, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const rows = [];
  const visitedGlobal = new Set();
  const seenImageUrls = new Set();

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();

    for (const target of targets) {
      let start;
      try {
        start = new URL(target);
      } catch {
        continue;
      }

      const brand = inferBrandFromHostOrPath(target);
      const queue = [start.href];
      const visitedLocal = new Set();
      let targetRowsBefore = rows.length;

      while (queue.length > 0 && visitedLocal.size < maxPages) {
        const current = queue.shift();
        if (!current || visitedLocal.has(current) || visitedGlobal.has(current)) continue;
        visitedLocal.add(current);
        visitedGlobal.add(current);

        let snap;
        try {
          await page.goto(current, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(waitMs);
          snap = await page.evaluate((imageLimit) => {
            const toAbs = (u) => {
              try {
                return new URL(u, location.href).href;
              } catch {
                return "";
              }
            };
            const imgs = [];
            const add = (url, meta) => {
              if (!url) return;
              imgs.push({
                url: toAbs(url),
                alt: meta.alt || "",
                title: meta.title || "",
                width: meta.width || 0,
                height: meta.height || 0,
                cls: meta.cls || "",
              });
            };
            document.querySelectorAll("img").forEach((img) => {
              add(img.currentSrc || img.src, {
                alt: img.alt,
                title: img.title,
                width: img.naturalWidth || img.width || 0,
                height: img.naturalHeight || img.height || 0,
                cls: img.className,
              });
              const srcset = img.getAttribute("srcset") || "";
              srcset
                .split(",")
                .map((x) => x.trim().split(" ")[0])
                .filter(Boolean)
                .forEach((u) => add(u, { alt: img.alt, title: img.title, cls: img.className }));
            });

            document
              .querySelectorAll("meta[property='og:image'],meta[name='og:image'],meta[name='twitter:image'],meta[property='twitter:image']")
              .forEach((m) => {
                add(m.getAttribute("content") || "", {
                  alt: "meta_image",
                  title: document.title || "",
                });
              });

            const links = Array.from(document.querySelectorAll("a[href]"))
              .map((a) => ({
                href: toAbs(a.getAttribute("href") || ""),
                text: (a.textContent || "").trim().slice(0, 120),
              }))
              .filter((x) => x.href && /^https?:\/\//i.test(x.href))
              .slice(0, 600);

            return {
              pageTitle: document.title || "",
              pageUrl: location.href,
              images: imgs.slice(0, imageLimit * 4),
              links,
            };
          }, maxImagesPerPage);
        } catch (err) {
          rows.push({
            brand,
            target: target,
            source_page: current,
            image_url: "",
            local_path: "",
            sku: "",
            style: "",
            color_hex: "",
            color_name: "",
            page_title: "",
            note: `page_error:${err.message}`,
          });
          continue;
        }

        const host = new URL(target).hostname;
        for (const lk of snap.links || []) {
          try {
            const u = new URL(lk.href);
            const sameHost = u.hostname === host || u.hostname.endsWith(`.${host}`);
            const likelyProductPath = /(product|shop|store|collection|item|catalog)/i.test(u.pathname);
            if (sameHost && likelyProductPath && !visitedLocal.has(u.href) && queue.length < maxPages * 3) {
              queue.push(u.href);
            }
          } catch {}
        }

        const pageImages = [];
        for (const img of snap.images || []) {
          if (!img.url || seenImageUrls.has(img.url)) continue;
          if (!/^https?:\/\//i.test(img.url)) continue;
          if (/\.svg($|\?)/i.test(img.url)) continue;
          seenImageUrls.add(img.url);
          pageImages.push(img);
          if (pageImages.length >= maxImagesPerPage) break;
        }

        for (const img of pageImages) {
          const sourceText = `${img.url} ${img.alt} ${img.title} ${snap.pageTitle}`;
          const sku = inferSku(sourceText);
          const style = inferStyle(sourceText);

          let localPath = "";
          let color = { hex: "", name: "unknown" };

          if (!noDownload) {
            try {
              const res = await fetch(img.url, { redirect: "follow", signal: AbortSignal.timeout(25000) });
              if (!res.ok) {
                rows.push({
                  brand,
                  target,
                  source_page: snap.pageUrl,
                  image_url: img.url,
                  local_path: "",
                  sku,
                  style,
                  color_hex: "",
                  color_name: "",
                  page_title: snap.pageTitle,
                  note: `download_status:${res.status}`,
                });
                continue;
              }

              const arr = await res.arrayBuffer();
              const buf = Buffer.from(arr);
              const extByType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
              let ext = "jpg";
              if (extByType.includes("png")) ext = "png";
              else if (extByType.includes("webp")) ext = "webp";
              else if (extByType.includes("gif")) ext = "gif";
              else {
                const m = img.url.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
                if (m) ext = m[1].toLowerCase();
              }
              const hash = crypto.createHash("sha1").update(img.url).digest("hex").slice(0, 12);
              const imageName = `${safeSlug(brand)}_${hash}.${ext}`;
              const dir = path.join(rawBase, safeSlug(brand));
              fs.mkdirSync(dir, { recursive: true });
              localPath = path.join(dir, imageName);
              fs.writeFileSync(localPath, buf);
              color = await dominantColorForFile(localPath);
            } catch (err) {
              rows.push({
                brand,
                target,
                source_page: snap.pageUrl,
                image_url: img.url,
                local_path: "",
                sku,
                style,
                color_hex: "",
                color_name: "",
                page_title: snap.pageTitle,
                note: `download_error:${err.message}`,
              });
              continue;
            }
          }

          rows.push({
            brand,
            target,
            source_page: snap.pageUrl,
            image_url: img.url,
            local_path: localPath,
            sku,
            style,
            color_hex: color.hex || "",
            color_name: color.name || "unknown",
            page_title: snap.pageTitle || "",
            note: "",
          });
        }
      }

      if (rows.length === targetRowsBefore) {
        rows.push({
          brand,
          target,
          source_page: start.href,
          image_url: "",
          local_path: "",
          sku: "",
          style: "unknown",
          color_hex: "",
          color_name: "unknown",
          page_title: "",
          note: "no_images_found",
        });
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  const jsonPath = path.join(outBase, "brand-image-catalog.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ run_id: runId, generated_at: new Date().toISOString(), rows }, null, 2) + "\n");

  const csvHeader = [
    "brand",
    "target",
    "source_page",
    "image_url",
    "local_path",
    "sku",
    "style",
    "color_hex",
    "color_name",
    "page_title",
    "note",
  ];
  const csvLines = [csvHeader.join(",")];
  for (const row of rows) {
    csvLines.push(csvHeader.map((k) => csvEscape(row[k])).join(","));
  }
  const csvPath = path.join(outBase, "brand-image-catalog.csv");
  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n");

  const byBrand = rows.reduce((acc, r) => {
    acc[r.brand] = (acc[r.brand] || 0) + 1;
    return acc;
  }, {});
  console.log("Brand image catalog complete");
  console.log(`run_id: ${runId}`);
  console.log(`json: ${jsonPath}`);
  console.log(`csv: ${csvPath}`);
  console.log(`rows: ${rows.length}`);
  console.log(`by_brand: ${JSON.stringify(byBrand)}`);
}

main().catch((err) => {
  console.error("brand-image-catalog failed:", err.message);
  process.exit(1);
});
