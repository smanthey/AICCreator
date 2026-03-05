"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const https = require("https");
const { register } = require("./registry");
const pg = require("../infra/postgres");

let openaiClient = null;
function getOpenAI() {
  if (openaiClient) return openaiClient;
  if (!process.env.OPENAI_API_KEY) return null;
  // Lazy-load so this agent can run in deterministic-only mode without OpenAI.
  // eslint-disable-next-line global-require
  const OpenAI = require("openai");
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function execFileBuffer(bin, args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.toString()?.trim() || err.message;
        return reject(new Error(`${bin} failed: ${msg}`));
      }
      resolve(Buffer.from(stdout));
    });
  });
}

function execFileText(bin, args, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.toString()?.trim() || err.message;
        return reject(new Error(`${bin} failed: ${msg}`));
      }
      resolve(String(stdout || "").trim());
    });
  });
}

async function hasBinary(name) {
  try {
    await execFileText("which", [name]);
    return true;
  } catch {
    return false;
  }
}

function hexFromRgb(r, g, b) {
  const p = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

function brightnessFromRgb(r, g, b) {
  // Perceptual brightness approximation normalized to 0..1.
  return Number(((0.299 * r + 0.587 * g + 0.114 * b) / 255).toFixed(5));
}

async function dominantColor(filePath) {
  const buf = await execFileBuffer(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-vf", "scale=1:1,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1"],
    45000
  );
  if (!buf || buf.length < 3) return null;
  const r = buf[0];
  const g = buf[1];
  const b = buf[2];
  return {
    r,
    g,
    b,
    dominant_color_hex: hexFromRgb(r, g, b),
    brightness: brightnessFromRgb(r, g, b),
  };
}

function tokenizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 24);
}

function tokenizeBlob(blob, max = 120) {
  return String(blob || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, max);
}

function toSlug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fetchJson(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "User-Agent": "claw-architect-media-visual/1.0" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`invalid_json_from_${url}: ${e.message}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout_${url}`)));
    req.on("error", reject);
  });
}

function safeReadFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function extractObjectFieldStrings(source, fieldName) {
  if (!source) return [];
  const out = [];
  const re = new RegExp(`${fieldName}\\s*:\\s*["'\`]([^"'\`]{2,200})["'\`]`, "g");
  let m;
  while ((m = re.exec(source))) {
    out.push(String(m[1] || "").trim());
    if (out.length >= 2000) break;
  }
  return out;
}

function extractShopifyCdnUrls(source) {
  if (!source) return [];
  const out = [];
  const re = /https:\/\/cdn\.shopify\.com\/[^\s"'`)]{8,400}/g;
  let m;
  while ((m = re.exec(source))) {
    out.push(m[0]);
    if (out.length >= 4000) break;
  }
  return out;
}

function toFileBaseSlug(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const base = path.basename(u.pathname || "").replace(/\.[a-z0-9]+$/i, "");
    return toSlug(base.replace(/[_]+/g, "-"));
  } catch {
    return "";
  }
}

function buildWmacRepoCatalogProducts(wmacRepoPath) {
  const products = [];
  if (!wmacRepoPath) return products;
  if (!fs.existsSync(wmacRepoPath)) return products;

  const files = [
    path.join(wmacRepoPath, "app/kickstarter/components/rewards-section.tsx"),
    path.join(wmacRepoPath, "components/sections/media-section.tsx"),
    path.join(wmacRepoPath, "components/sections/toys-section.tsx"),
    path.join(wmacRepoPath, "utils/translations/en.ts"),
  ];

  const seen = new Set();
  for (const filePath of files) {
    const src = safeReadFile(filePath);
    if (!src) continue;

    const titles = [
      ...extractObjectFieldStrings(src, "title"),
      ...extractObjectFieldStrings(src, "desc"),
      ...extractObjectFieldStrings(src, "subtitle"),
    ];
    for (const title of titles) {
      const cleanTitle = String(title || "").trim();
      if (!cleanTitle || cleanTitle.length < 3) continue;
      const handle = toSlug(cleanTitle);
      if (!handle || seen.has(`t:${handle}`)) continue;
      seen.add(`t:${handle}`);
      const item = buildCatalogProduct(
        {
          title: cleanTitle,
          handle,
          aliases: [cleanTitle, handle, "wmac", "wmac masters"],
          tags: ["wmac", "wmac masters", "kickstarter", "legacy minifigure", "martial arts collectibles"],
        },
        "repo:wmac"
      );
      if (item) products.push(item);
    }

    const shopifyUrls = extractShopifyCdnUrls(src);
    for (const url of shopifyUrls) {
      const slug = toFileBaseSlug(url);
      if (!slug || slug.length < 3 || seen.has(`u:${slug}`)) continue;
      seen.add(`u:${slug}`);
      const human = slug.replace(/-/g, " ");
      const item = buildCatalogProduct(
        {
          title: `WMAC ${human}`,
          handle: slug,
          aliases: [slug, human, url, "wmac", "wmac masters"],
          tags: ["wmac", "wmac masters", "shopify cdn asset"],
        },
        "repo:wmac"
      );
      if (item) products.push(item);
    }
  }

  return products;
}

function inferProductFamily(title, handle, tags = []) {
  const blob = `${title} ${handle} ${(tags || []).join(" ")}`.toLowerCase();
  if (/balaclava|bunski|ski.?mask|beanie|hat|stockings|socks/.test(blob)) return "apparel";
  if (/acne|patch|hydrocolloid|skincare|beauty/.test(blob)) return "beauty";
  if (/contact.?lens|lens/.test(blob)) return "cosmetic_lenses";
  if (/plush|plushie|toy|collector/.test(blob)) return "plush_collectible";
  if (/ashtray|shaker|kitchen|home|dish/.test(blob)) return "home_goods";
  if (/bundle|pack|set/.test(blob)) return "bundle";
  if (/wmac|minifig|minifigure|blind.?box|dragon.?star|kickstarter|cast|enamel|sticker|patch|headband/.test(blob)) return "collectible_merch";
  return "general_merch";
}

function buildCatalogProduct(row, source) {
  const title = String(row?.title || "").trim();
  const handle = String(row?.handle || "").trim();
  if (!title) return null;
  const tags = Array.isArray(row?.tags) ? row.tags.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean) : [];
  const aliases = [title, handle, ...(Array.isArray(row?.aliases) ? row.aliases : [])]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const aliasTokens = aliases.flatMap((a) => tokenizeBlob(a, 32)).filter(Boolean);
  const family = inferProductFamily(title, handle, tags);
  return {
    source,
    title,
    handle: handle || toSlug(title),
    product_family: family,
    aliases,
    tokens: [...new Set(aliasTokens)].slice(0, 48),
  };
}

async function loadProductCatalog() {
  const catalog = [];

  // Shopify catalog for examplebrand.com (live)
  try {
    const plushtrap = await fetchJson("https://examplebrand.com/products.json?limit=250");
    const products = Array.isArray(plushtrap?.products) ? plushtrap.products : [];
    for (const p of products) {
      const item = buildCatalogProduct(
        {
          title: p.title,
          handle: p.handle,
          tags: typeof p.tags === "string" ? p.tags.split(",").map((x) => x.trim()) : [],
        },
        "shopify:examplebrand.com"
      );
      if (item) catalog.push(item);
    }
  } catch {}

  // Fallback seeded catalog for Etsy plushtrapshop + WMAC Health.
  // Etsy blocks static fetch in most non-browser environments, so keep deterministic aliases here.
  const seeded = [
    { source: "etsy:plushtrapshop", title: "Bunski Balaclava", handle: "bunski-balaclava", aliases: ["bunny ear ski mask", "3-hole balaclava", "plush trap bunski"] },
    { source: "etsy:plushtrapshop", title: "Bunny Beanie", handle: "bunny-beanie", aliases: ["satin lined bunny beanie", "fleece bunny beanie"] },
    { source: "etsy:plushtrapshop", title: "Killa Bunny Acne Patches", handle: "killa-bunny-acne-patches", aliases: ["zit happens patches", "hydrocolloid pimple patches"] },
    { source: "wmac_health", title: "Hydrocolloid Acne Patches", handle: "hydrocolloid-acne-patches", aliases: ["acne patch", "pimple patch", "spot patch", "wmac health patch"] },
    { source: "wmac_health", title: "Skincare Spot Dots", handle: "skincare-spot-dots", aliases: ["blemish dots", "spot dots", "wmac spot dots"] },
  ];
  for (const p of seeded) {
    const item = buildCatalogProduct(p, p.source);
    if (item) catalog.push(item);
  }

  // Local WMAC repo catalog (preferred when available)
  const wmacRepoPath = process.env.WMAC_REPO_PATH || "$HOME/claw-repos/wmac";
  const wmacProducts = buildWmacRepoCatalogProducts(wmacRepoPath);
  for (const p of wmacProducts) catalog.push(p);

  const uniq = new Map();
  for (const item of catalog) {
    if (!item) continue;
    const key = `${item.source || "unknown"}::${item.handle || toSlug(item.title || "")}`;
    if (!uniq.has(key)) {
      uniq.set(key, item);
      continue;
    }
    const prev = uniq.get(key);
    uniq.set(key, {
      ...prev,
      aliases: [...new Set([...(prev.aliases || []), ...(item.aliases || [])])].slice(0, 32),
      tokens: [...new Set([...(prev.tokens || []), ...(item.tokens || [])])].slice(0, 64),
    });
  }

  return [...uniq.values()];
}

function matchProductFromCatalog(contextBlob, catalog) {
  const hayTokens = new Set(tokenizeBlob(contextBlob, 200));
  let best = null;
  for (const product of catalog) {
    const matched = product.tokens.filter((t) => hayTokens.has(t));
    const score = matched.length;
    if (score < 2) continue;
    if (!best || score > best.score) {
      best = {
        source: product.source,
        handle: product.handle,
        title: product.title,
        product_family: product.product_family,
        score,
        matched_tokens: matched.slice(0, 8),
      };
    }
  }
  return best;
}

function detectLocationSignals(filePath) {
  const p = String(filePath || "").toLowerCase();
  const out = new Set();

  const checks = [
    [/\/dcim\//, "camera_roll"],
    [/\/camera\//, "camera_roll"],
    [/\/screenshots?\//, "screenshots"],
    [/\/screen recordings?\//, "screen_recordings"],
    [/\/downloads\//, "downloads"],
    [/\/desktop\//, "desktop"],
    [/\/documents\//, "documents"],
    [/\/pictures\//, "pictures"],
    [/\/photos?\//, "photos"],
    [/\/receipts?\//, "receipts_folder"],
    [/\/invoices?\//, "invoices_folder"],
    [/\/product|\/catalog|\/line.?sheet|\/listing/i, "product_assets"],
    [/\/shoot|\/session|\/studio/i, "photo_shoot"],
    [/\/social|\/tiktok|\/instagram|\/facebook/i, "social_assets"],
  ];

  for (const [regex, signal] of checks) {
    if (regex.test(p)) out.add(signal);
  }
  return [...out];
}

function inferOrientation(width, height) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!w || !h) return "unknown";
  if (Math.abs(w - h) <= Math.max(2, Math.round(Math.min(w, h) * 0.02))) return "square";
  return w > h ? "landscape" : "portrait";
}

function deterministicVision(row, productCatalog = []) {
  const labels = new Set();
  const locationSignals = detectLocationSignals(row.path);
  const filenameSignals = tokenizeName(row.name);
  const allTokens = new Set([...filenameSignals, ...locationSignals]);
  const pathTokens = tokenizeBlob(row.path, 80);
  const blob = `${row.name || ""} ${row.path || ""} ${(Array.isArray(row.semantic_tags) ? row.semantic_tags.join(" ") : "")}`;

  const keywordRules = [
    [["receipt", "invoice", "statement", "contract", "letter"], { labels: ["document"], scene: "document" }],
    [["screenshot", "screen"], { labels: ["screenshot", "ui"], scene: "screenshot" }],
    [["logo", "brandmark"], { labels: ["logo", "branding"], scene: "design_asset" }],
    [["mockup", "banner", "ad", "creative"], { labels: ["marketing_asset"], scene: "design_asset" }],
    [["product", "pack", "packaging", "label", "box"], { labels: ["product"], scene: "product" }],
    [["selfie", "portrait", "headshot"], { labels: ["person"], scene: "portrait" }],
    [["menu"], { labels: ["menu", "document"], scene: "document" }],
    [["toy", "game", "boardgame", "wallstreetopoly"], { labels: ["toy", "game"], scene: "product" }],
    [["skynpatch", "patch"], { labels: ["wellness", "product"], scene: "product" }],
  ];

  let sceneType = null;
  for (const [keys, rule] of keywordRules) {
    if (keys.some((k) => allTokens.has(k))) {
      for (const l of rule.labels) labels.add(l);
      if (!sceneType && rule.scene) sceneType = rule.scene;
    }
  }

  if (locationSignals.includes("screenshots")) {
    labels.add("screenshot");
    labels.add("ui");
    sceneType = sceneType || "screenshot";
  }
  if (locationSignals.includes("product_assets") || locationSignals.includes("photo_shoot")) {
    labels.add("product");
    sceneType = sceneType || "product";
  }
  if (!sceneType && String(row.mime || "").startsWith("image/")) {
    sceneType = labels.has("document") ? "document" : "photo";
  }

  const matchedProduct = matchProductFromCatalog(blob, productCatalog);
  if (matchedProduct) {
    labels.add("product");
    labels.add("catalog_match");
    labels.add(`family_${matchedProduct.product_family}`);
    labels.add(`product_${matchedProduct.handle.replace(/[^a-z0-9]+/g, "_")}`.slice(0, 48));
    if (!sceneType || sceneType === "photo") sceneType = "product";
  }

  const level1Capture = locationSignals.includes("screenshots") ? "screen_capture" : "camera_or_render";
  const level2VisualType = sceneType || (labels.has("document") ? "document" : "photo");
  const level3CommerceType = matchedProduct?.product_family || (labels.has("product") ? "generic_product" : "non_product");
  const ruleTags = [
    `l1_${level1Capture}`,
    `l2_${level2VisualType}`,
    `l3_${level3CommerceType}`,
    ...pathTokens.slice(0, 6).map((t) => `path_${t}`),
  ];

  return {
    labels: [...labels].slice(0, 20),
    scene_type: sceneType,
    primary_subject: matchedProduct?.title || [...labels][0] || null,
    location_signals: locationSignals.slice(0, 20),
    filename_signals: filenameSignals.slice(0, 20),
    rule_tags: [...new Set(ruleTags)].slice(0, 24),
    levels: {
      level1_capture: level1Capture,
      level2_visual_type: level2VisualType,
      level3_commerce_type: level3CommerceType,
    },
    product_match: matchedProduct || null,
  };
}

function parseVisionJson(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    const obj = JSON.parse(clean);
    return {
      labels: Array.isArray(obj.labels) ? obj.labels.map((x) => String(x).toLowerCase()).slice(0, 20) : [],
      scene_type: obj.scene_type ? String(obj.scene_type).toLowerCase().slice(0, 50) : null,
      primary_subject: obj.primary_subject ? String(obj.primary_subject).toLowerCase().slice(0, 80) : null,
      summary: obj.summary ? String(obj.summary).slice(0, 600) : null,
      confidence: obj.confidence == null ? null : Math.max(0, Math.min(1, Number(obj.confidence))),
    };
  } catch {
    return null;
  }
}

function buildImageUrlContentPart(mime, b64) {
  const normalizedMime = String(mime || "image/jpeg").trim();
  const normalizedB64 = String(b64 || "").trim();
  if (!normalizedB64) return null;

  // Reject obviously malformed payloads and ensure the decoded bytes are non-empty.
  if (!/^[A-Za-z0-9+/=]+$/.test(normalizedB64)) return null;
  let decodedLength = 0;
  try {
    decodedLength = Buffer.from(normalizedB64, "base64").length;
  } catch {
    return null;
  }
  if (decodedLength === 0) return null;

  return {
    type: "image_url",
    image_url: { url: `data:${normalizedMime};base64,${normalizedB64}` },
  };
}

async function openaiVision(filePath, row) {
  const client = getOpenAI();
  if (!client) return null;

  const maxBytes = Math.max(256 * 1024, Number(process.env.MEDIA_VISUAL_OPENAI_MAX_BYTES || (4 * 1024 * 1024)));
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) return null;
  if (stat.size === 0) return null; // avoid sending empty base64 (invalid_request_error)

  const b64 = fs.readFileSync(filePath).toString("base64");
  if (!b64 || b64.length === 0) return null; // never send empty image_url.base64 to vision API

  const mime = String(row.mime || "image/jpeg");
  const imagePart = buildImageUrlContentPart(mime, b64);
  if (!imagePart) return null;
  const model = process.env.MEDIA_VISUAL_OPENAI_MODEL || "gpt-4o-mini";

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Return strict JSON only: {labels:string[], scene_type:string, primary_subject:string, summary:string, confidence:number}.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this image for cataloging. Focus on product/document/person/scene intent and practical search tags.",
          },
          imagePart,
        ],
      },
    ],
  });

  const raw = completion?.choices?.[0]?.message?.content || "";
  const parsed = parseVisionJson(raw);
  if (!parsed) return null;
  return { ...parsed, model_used: model, source: "openai_vision" };
}

function mergeVision(det, ai) {
  if (!ai) {
    const conf = Number(Math.min(0.92, 0.45 + det.labels.length * 0.08 + det.location_signals.length * 0.03).toFixed(5));
    return {
      labels: det.labels,
      scene_type: det.scene_type,
      primary_subject: det.primary_subject,
      summary: null,
      confidence: conf,
      source: "deterministic",
      model_used: "deterministic-visual-v1",
    };
  }
  const labels = [...new Set([...(det.labels || []), ...(ai.labels || [])])].slice(0, 20);
  const confidence = Number(Math.max(0.5, Math.min(0.98, ai.confidence ?? 0.75)).toFixed(5));
  return {
    labels,
    scene_type: ai.scene_type || det.scene_type,
    primary_subject: ai.primary_subject || det.primary_subject,
    summary: ai.summary || null,
    confidence,
    source: "hybrid",
    model_used: ai.model_used || "openai_vision",
  };
}

register("media_visual_catalog", async (payload = {}) => {
  const {
    limit = 150,
    hostname,
    force = false,
    dry_run = false,
    use_openai_vision = String(process.env.MEDIA_VISUAL_USE_OPENAI || "false").toLowerCase() === "true",
  } = payload;

  const ffmpegOk = await hasBinary("ffmpeg");
  if (!ffmpegOk) throw new Error("media_visual_catalog requires ffmpeg in PATH");
  const productCatalog = await loadProductCatalog();

  const where = ["fi.mime LIKE 'image/%'"];
  const params = [];

  if (hostname) {
    params.push(hostname);
    where.push(`fi.hostname = $${params.length}`);
  }

  if (!force) {
    where.push("NOT EXISTS (SELECT 1 FROM media_visual_catalog mvc WHERE mvc.file_index_id = fi.id)");
  }

  params.push(Math.min(Math.max(Number(limit) || 150, 1), 5000));

  const { rows } = await pg.query(
    `SELECT fi.id, fi.path, fi.name, fi.ext, fi.mime, fi.category, fi.semantic_tags, fi.category_confidence,
            mm.width, mm.height
       FROM file_index fi
       LEFT JOIN media_metadata mm ON mm.file_index_id = fi.id
      WHERE ${where.join(" AND ")}
      ORDER BY fi.indexed_at DESC
      LIMIT $${params.length}`,
    params
  );

  let processed = 0;
  let stored = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];
  let costUsd = 0;

  for (const row of rows) {
    if (!fs.existsSync(row.path)) {
      skipped++;
      continue;
    }
    processed++;
    try {
      const det = deterministicVision(row, productCatalog);
      const color = await dominantColor(row.path).catch(() => null);
      const ai = use_openai_vision ? await openaiVision(row.path, row).catch(() => null) : null;
      const merged = mergeVision(det, ai);

      const orientation = inferOrientation(row.width, row.height);
      const mergedTags = [
        ...new Set([
          ...(Array.isArray(row.semantic_tags) ? row.semantic_tags : []),
          ...merged.labels,
          ...(Array.isArray(det.rule_tags) ? det.rule_tags : []),
          ...(det?.product_match?.handle ? [`product_handle_${det.product_match.handle.replace(/[^a-z0-9]+/g, "_")}`] : []),
          ...(det?.product_match?.source ? [`product_source_${String(det.product_match.source).replace(/[^a-z0-9]+/g, "_")}`] : []),
        ]),
      ].slice(0, 40);
      const conf = Number(Math.max(Number(row.category_confidence || 0), Number(merged.confidence || 0)).toFixed(5));

      const analysisJson = {
        deterministic: det,
        ai: ai || null,
        color: color || null,
        rule_levels: det.levels || null,
        product_match: det.product_match || null,
        product_catalog_size: productCatalog.length,
      };

      if (!dry_run) {
        await pg.query(
          `INSERT INTO media_visual_catalog (
             file_index_id, source, model_used, visual_labels, scene_type, primary_subject, visual_summary,
             location_signals, filename_signals, dominant_color_hex, brightness, orientation, confidence, analysis_json
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (file_index_id) DO UPDATE SET
             source = EXCLUDED.source,
             model_used = EXCLUDED.model_used,
             visual_labels = EXCLUDED.visual_labels,
             scene_type = EXCLUDED.scene_type,
             primary_subject = EXCLUDED.primary_subject,
             visual_summary = EXCLUDED.visual_summary,
             location_signals = EXCLUDED.location_signals,
             filename_signals = EXCLUDED.filename_signals,
             dominant_color_hex = EXCLUDED.dominant_color_hex,
             brightness = EXCLUDED.brightness,
             orientation = EXCLUDED.orientation,
             confidence = EXCLUDED.confidence,
             analysis_json = EXCLUDED.analysis_json,
             analyzed_at = NOW(),
             updated_at = NOW()`,
          [
            row.id,
            merged.source,
            merged.model_used,
            merged.labels,
            merged.scene_type,
            merged.primary_subject,
            merged.summary,
            det.location_signals,
            det.filename_signals,
            color?.dominant_color_hex || null,
            color?.brightness ?? null,
            orientation,
            merged.confidence,
            JSON.stringify(analysisJson),
          ]
        );

        await pg.query(
          `UPDATE file_index
              SET category = COALESCE(category, 'image'),
                  sub_category = COALESCE($2, sub_category),
                  category_confidence = CASE
                    WHEN category_confidence IS NULL THEN $3
                    ELSE GREATEST(category_confidence, $3)
                  END,
                  category_reason = CASE
                    WHEN category_reason IS NULL OR category_reason = '' THEN 'visual_catalog'
                    WHEN position('visual_catalog' in category_reason) > 0 THEN category_reason
                    ELSE category_reason || '|visual_catalog'
                  END,
                  semantic_tags = $4,
                  semantic_summary = COALESCE($5, semantic_summary),
                  classified_at = NOW(),
                  classify_model = $6
            WHERE id = $1`,
          [row.id, merged.scene_type, conf, mergedTags, merged.summary, merged.model_used]
        );
      }

      if (ai?.confidence != null) {
        costUsd += Number(process.env.MEDIA_VISUAL_OPENAI_COST_ESTIMATE_PER_IMAGE || 0.003);
      }
      stored++;
    } catch (e) {
      failed++;
      if (errors.length < 30) {
        errors.push({ id: row.id, path: row.path, error: e.message });
      }
    }
  }

  return {
    scanned: rows.length,
    processed,
    stored,
    skipped,
    failed,
    dry_run: !!dry_run,
    source_mode: use_openai_vision ? "hybrid" : "deterministic",
    tools: { ffmpeg: ffmpegOk, openai: !!getOpenAI() },
    model_used: use_openai_vision ? (process.env.MEDIA_VISUAL_OPENAI_MODEL || "gpt-4o-mini") : "deterministic-visual-v1",
    cost_usd: Number(costUsd.toFixed(6)),
    errors,
  };
});
