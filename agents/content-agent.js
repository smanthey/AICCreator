// agents/content-agent.js
// Handles fetch_content and analyze_content task types.
//
// fetch_content payload:
//   { brand_slug, platform: 'youtube'|'tiktok'|'instagram', handle, max_results: 10 }
//   → stores content_items rows, returns { items_fetched, items_stored }
//
// analyze_content payload:
//   { brand_slug, platform?, limit: 20, plan_id?, task_id? }
//   → reads recent content_items, runs Claude analysis,
//     stores content_briefs row, returns brief

"use strict";

const https   = require("https");
const pg      = require("../infra/postgres");
const { register } = require("./registry");
const { chatJson } = require("../infra/model-router");
const { loadAgentPrelude, appendAgentDailyLog } = require("../control/agent-memory");

// ─── Helpers ──────────────────────────────────────────────────

/** Simple HTTPS GET → parsed JSON */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse failed: ${raw.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

/** POST JSON to a URL, returns parsed JSON */
function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function withContentPrelude(system) {
  const prelude = await loadAgentPrelude("content", {
    handoffs: ["DAILY-INTEL.md", "DAILY-DRAFTS.md"],
    maxChars: 12000,
  });
  return [prelude.text, system].filter(Boolean).join("\n\n");
}

async function contentWriteback(entry) {
  await appendAgentDailyLog("content", entry).catch(() => {});
}

// ─── YouTube fetch ────────────────────────────────────────────

async function fetchYouTube(handle, maxResults = 10, brandSlug, planId, taskId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY not set");

  // Resolve handle → channel ID
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(handle)}&type=channel&maxResults=1&key=${apiKey}`;
  const searchRes = await httpGet(searchUrl);
  const channelId = searchRes.items?.[0]?.snippet?.channelId || searchRes.items?.[0]?.id?.channelId;
  if (!channelId) throw new Error(`YouTube channel not found for handle: ${handle}`);

  // Get recent videos
  const videoUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=${maxResults}&key=${apiKey}`;
  const videoRes = await httpGet(videoUrl);
  const videoIds = (videoRes.items || []).map((v) => v.id?.videoId).filter(Boolean);

  if (!videoIds.length) return [];

  // Get stats
  const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(",")}&key=${apiKey}`;
  const statsRes = await httpGet(statsUrl);

  const items = [];
  for (const v of statsRes.items || []) {
    const s = v.statistics || {};
    items.push({
      source:    "youtube",
      handle,
      post_id:   v.id,
      url:       `https://youtu.be/${v.id}`,
      caption:   v.snippet?.title + "\n" + (v.snippet?.description || "").slice(0, 500),
      views:     parseInt(s.viewCount  || 0),
      likes:     parseInt(s.likeCount  || 0),
      comments:  parseInt(s.commentCount || 0),
      shares:    0,
      posted_at: v.snippet?.publishedAt || null,
      raw_data:  v,
      brand_slug: brandSlug,
      plan_id:    planId,
      task_id:    taskId,
    });
  }
  return items;
}

// ─── TikTok / Instagram fetch via Apify ───────────────────────

async function fetchApify(platform, handle, maxResults = 20, brandSlug, planId, taskId) {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) throw new Error("APIFY_API_KEY not set");

  // Actor IDs for popular Apify scrapers
  const actors = {
    tiktok:    "clockworks~free-tiktok-scraper",
    instagram: "apify~instagram-scraper",
  };
  const actorId = actors[platform];
  if (!actorId) throw new Error(`No Apify actor for platform: ${platform}`);

  // Build input per platform
  const input = platform === "tiktok"
    ? { profiles: [handle], resultsPerPage: maxResults }
    : { usernames: [handle], resultsType: "posts", resultsLimit: maxResults };

  // Start run
  const runRes = await httpPost(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${apiKey}`,
    input
  );
  const runId = runRes.data?.id;
  if (!runId) throw new Error(`Apify run failed: ${JSON.stringify(runRes).slice(0, 300)}`);

  // Poll until finished (max 90s)
  let status = "RUNNING";
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await httpGet(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiKey}`);
    status = poll.data?.status;
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
  }
  if (status !== "SUCCEEDED") throw new Error(`Apify run ended with status: ${status}`);

  // Fetch dataset
  const datasetId = (await httpGet(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiKey}`)).data?.defaultDatasetId;
  const dataset   = await httpGet(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}`);

  return (dataset || []).slice(0, maxResults).map((item) => {
    const isIG = platform === "instagram";
    return {
      source:    platform,
      handle,
      post_id:   item.id || item.postId || item.videoId,
      url:       item.url || item.webVideoUrl || item.link,
      caption:   item.text || item.caption || item.description || "",
      views:     isIG ? (item.videoViewCount || 0) : (item.playCount || item.viewCount || 0),
      likes:     item.likesCount || item.likes || item.diggCount || 0,
      comments:  item.commentsCount || item.comments || 0,
      shares:    item.sharesCount || item.shareCount || 0,
      posted_at: item.createTimeISO || item.timestamp || null,
      raw_data:  item,
      brand_slug: brandSlug,
      plan_id:    planId,
      task_id:    taskId,
    };
  });
}

// ─── Store content items ──────────────────────────────────────

async function storeItems(items) {
  let stored = 0;
  for (const it of items) {
    // Ensure post_id is never null (UNIQUE constraint allows multiple NULLs in Postgres,
    // but that creates un-dedupable rows and phantom duplicates).
    if (!it.post_id) {
      const { createHash } = require("crypto");
      it.post_id = createHash("sha256")
        .update(`${it.source}:${it.handle}:${it.url || it.caption || Math.random()}`)
        .digest("hex")
        .slice(0, 32);
    }
    try {
      const res = await pg.query(
        `INSERT INTO content_items
           (brand_slug, source, handle, post_id, url, caption,
            likes, comments, shares, views, posted_at, raw_data, plan_id, task_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (post_id) DO NOTHING`,
        [
          it.brand_slug, it.source, it.handle, it.post_id, it.url,
          it.caption, it.likes, it.comments, it.shares, it.views,
          it.posted_at, JSON.stringify(it.raw_data), it.plan_id, it.task_id,
        ]
      );
      // Only count actual inserts — ON CONFLICT DO NOTHING gives rowCount=0
      if (res.rowCount > 0) stored++;
    } catch (e) {
      console.warn(`[content] skip item ${it.post_id}: ${e.message}`);
    }
  }
  return stored;
}

// ─── fetch_content handler ────────────────────────────────────

register("fetch_content", async (payload) => {
  let { brand_slug, platform, handle, max_results = 15, plan_id, task_id } = payload;
  if (!brand_slug) throw new Error("fetch_content requires brand_slug");
  if (!platform)   throw new Error("fetch_content requires platform: youtube|tiktok|instagram");
  if (!handle)     throw new Error("fetch_content requires handle");

  // Strip leading @ from handle if present
  handle = handle.replace(/^@/, "").trim();

  // Cap max_results to prevent runaway API spend
  max_results = Math.min(Math.max(1, parseInt(max_results) || 15), 50);

  // Validate brand exists
  const brandCheck = await pg.query("SELECT slug FROM brands WHERE slug = $1", [brand_slug]);
  if (!brandCheck.rows.length) throw new Error(`Unknown brand_slug: "${brand_slug}". Register via brands table first.`);

  console.log(`[content] fetch_content brand=${brand_slug} platform=${platform} handle=${handle}`);

  let items = [];
  if (platform === "youtube") {
    items = await fetchYouTube(handle, max_results, brand_slug, plan_id, task_id);
  } else if (["tiktok", "instagram"].includes(platform)) {
    items = await fetchApify(platform, handle, max_results, brand_slug, plan_id, task_id);
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const stored = await storeItems(items);
  console.log(`[content] fetched ${items.length} items, stored ${stored} new`);

  return {
    brand_slug,
    platform,
    handle,
    items_fetched: items.length,
    items_stored:  stored,
    cost_usd: 0,
    model_used: "n/a",
  };
});

// ─── analyze_content handler ──────────────────────────────────

register("analyze_content", async (payload) => {
  const {
    brand_slug, platform, limit = 20, plan_id, task_id
  } = payload;
  if (!brand_slug) throw new Error("analyze_content requires brand_slug");

  console.log(`[content] analyze_content brand=${brand_slug} platform=${platform || "all"} limit=${limit}`);

  // Pull recent high-performing content for this brand
  const whereClause = platform
    ? "WHERE brand_slug = $1 AND source = $2 ORDER BY views DESC NULLS LAST, likes DESC NULLS LAST LIMIT $3"
    : "WHERE brand_slug = $1 ORDER BY views DESC NULLS LAST, likes DESC NULLS LAST LIMIT $2";
  const params = platform ? [brand_slug, platform, limit] : [brand_slug, limit];

  const rows = await pg.query(
    `SELECT id, source, handle, url, caption, likes, comments, shares, views, posted_at FROM content_items ${whereClause}`,
    params
  );

  if (!rows.rows.length) {
    throw new Error(`No content_items found for brand_slug=${brand_slug}${platform ? ` platform=${platform}` : ""}. Run fetch_content first.`);
  }

  // Guardrail: LLM analysis with fewer than 3 items produces unreliable output
  if (rows.rows.length < 3) {
    console.warn(`[content] analyze_content: only ${rows.rows.length} items — results may be low confidence`);
  }

  // Fetch brand info
  const brandRow = await pg.query("SELECT * FROM brands WHERE slug = $1", [brand_slug]);
  const brand = brandRow.rows[0] || { name: brand_slug, target_demo: "unknown" };

  // Build the analysis prompt
  const contentList = rows.rows.map((r, i) => {
    const views    = r.views    ? `${(r.views/1000).toFixed(1)}K views` : "";
    const likes    = r.likes    ? `${(r.likes/1000).toFixed(1)}K likes` : "";
    const comments = r.comments ? `${r.comments} comments` : "";
    const stats    = [views, likes, comments].filter(Boolean).join(" | ");
    return `[${i+1}] @${r.handle} (${r.source})\nURL: ${r.url}\nStats: ${stats}\nCaption: ${(r.caption || "").slice(0, 300)}\n`;
  }).join("\n---\n");

  const systemPromptBase = `You are a viral content strategist specializing in social media growth for DTC brands.
Analyze the provided top-performing content from competitor accounts and output a detailed content brief.

Brand: ${brand.name}
Niche: ${brand.niche || "unknown"}
Target demo: ${brand.target_demo}
Platform focus: ${platform || "multi-platform"}

Output JSON with this exact schema:
{
  "title": "Brief title summarizing the dominant content theme",
  "hook_pattern": "How the best hooks open — first 2-3 seconds / first line pattern",
  "script_outline": "General script structure that works: opener → middle → close pattern",
  "pacing_notes": "Edit pace, cut frequency, visual style, music type observed",
  "cta": "The CTA pattern that appears in high-performing posts",
  "platform": "${platform || "multi-platform"}",
  "content_type": "e.g. tutorial, transformation, POV, lifestyle, drop-reveal, testimonial",
  "top_hooks": ["hook 1", "hook 2", "hook 3"],
  "suggested_concepts": [
    { "title": "...", "hook": "...", "outline": "..." }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of pattern observed"
}`;
  const systemPrompt = await withContentPrelude(systemPromptBase);

  // model-router routes analyze_content: gemini_flash → deepseek_chat → api_haiku
  const llmResult = await chatJson(
    "analyze_content",
    systemPrompt,
    `Analyze these ${rows.rows.length} top posts:\n\n${contentList}`,
    { max_tokens: 1500, task_id, plan_id }
  );

  let analysis = llmResult.json;
  if (!analysis) {
    throw new Error(`analyze_content: LLM returned unparseable JSON. Raw: ${llmResult.text?.slice(0, 300)}`);
  }

  // Guardrail: require minimum fields to prevent storing hallucinated empty briefs
  if (!analysis.hook_pattern && !analysis.title) {
    throw new Error(
      `analyze_content: LLM brief is missing required fields (hook_pattern, title). ` +
      `Raw: ${(llmResult.text || "").slice(0, 200)}`
    );
  }

  // Store brief
  const sourceIds = rows.rows.map((r) => r.id);
  const insertRes = await pg.query(
    `INSERT INTO content_briefs
       (brand_slug, title, hook_pattern, script_outline, pacing_notes, cta,
        platform, content_type, confidence, raw_analysis, source_items, plan_id, task_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      brand_slug,
      analysis.title          || null,
      analysis.hook_pattern   || null,
      analysis.script_outline || null,
      analysis.pacing_notes   || null,
      analysis.cta            || null,
      analysis.platform       || platform || null,
      analysis.content_type   || null,
      analysis.confidence     || null,
      JSON.stringify(analysis),
      sourceIds,
      plan_id, task_id,
    ]
  );

  const briefId = insertRes.rows[0]?.id;
  console.log(`[content] analyze_content → brief ${briefId}`);
  await contentWriteback({
    task_type: "analyze_content",
    goal: `brand=${brand_slug} platform=${platform || "all"}`,
    summary: `brief created ${briefId} from ${rows.rows.length} posts`,
    learned: analysis.hook_pattern || analysis.title || "",
    model_used: llmResult.model_used || llmResult.model_id || llmResult.model_key,
    cost_usd: Number(llmResult.cost_usd || 0),
  });

  return {
    brief_id:           briefId,
    brand_slug,
    platform:           analysis.platform,
    content_type:       analysis.content_type,
    title:              analysis.title,
    hook_pattern:       analysis.hook_pattern,
    suggested_concepts: analysis.suggested_concepts || [],
    source_items:       sourceIds.length,
    cost_usd:           parseFloat((llmResult.cost_usd || 0).toFixed(6)),
    model_used:         llmResult.model_used || llmResult.model_id || llmResult.model_key,
    provider_used:      llmResult.provider_used || llmResult.provider,
    provider:           llmResult.provider_used || llmResult.provider,
    confidence:         llmResult.confidence ?? null,
    escalation_reason:  llmResult.escalation_reason || null,
    cache_hit:          llmResult.cache_hit === true,
  };
});

// ─── generate_copy handler ───────────────────────────────────

register("generate_copy", async (payload) => {
  const {
    brand_slug,
    format,
    brief = "",
    plan_id,
    task_id,
  } = payload || {};

  if (!brand_slug) throw new Error("generate_copy requires brand_slug");
  if (!format) throw new Error("generate_copy requires format: email|caption|product_desc");

  const allowed = new Set(["email", "caption", "product_desc"]);
  if (!allowed.has(format)) {
    throw new Error(`generate_copy format "${format}" invalid; use email|caption|product_desc`);
  }

  const brandRow = await pg.query("SELECT * FROM brands WHERE slug = $1", [brand_slug]);
  const brand = brandRow.rows[0];
  if (!brand) throw new Error(`Unknown brand_slug: "${brand_slug}"`);

  const latestBrief = await pg.query(
    `SELECT id, title, hook_pattern, script_outline, cta, raw_analysis
     FROM content_briefs
     WHERE brand_slug = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [brand_slug]
  );

  const briefRow = latestBrief.rows[0] || null;

  const systemBase = `You are a senior direct-response copywriter.
Return ONLY strict JSON with this schema:
{
  "title": "string",
  "format": "${format}",
  "body": "string",
  "cta": "string",
  "notes": "string"
}`;
  const system = await withContentPrelude(systemBase);

  const user = [
    `Brand: ${brand.name} (${brand.slug})`,
    `Niche: ${brand.niche || "unknown"}`,
    `Target demo: ${brand.target_demo || "unknown"}`,
    `Requested format: ${format}`,
    `User brief: ${brief || "(none)"}`,
    briefRow ? `Latest analysis title: ${briefRow.title || "(none)"}` : "Latest analysis: (none)",
    briefRow ? `Hook pattern: ${briefRow.hook_pattern || "(none)"}` : "",
    briefRow ? `Script outline: ${briefRow.script_outline || "(none)"}` : "",
    briefRow ? `CTA guidance: ${briefRow.cta || "(none)"}` : "",
  ].filter(Boolean).join("\n");

  const llmResult = await chatJson("generate_copy", system, user, { max_tokens: 1400, task_id, plan_id });
  const out = llmResult.json || {};

  if (!out.body || typeof out.body !== "string") {
    throw new Error(`generate_copy returned invalid body. Raw: ${(llmResult.text || "").slice(0, 200)}`);
  }
  await contentWriteback({
    task_type: "generate_copy",
    goal: `brand=${brand_slug} format=${format}`,
    summary: `generated copy with source_brief=${briefRow?.id || "none"}`,
    model_used: llmResult.model_used || llmResult.model_id || llmResult.model_key,
    cost_usd: Number(llmResult.cost_usd || 0),
  });

  return {
    brand_slug,
    format,
    title: out.title || `${brand.name} ${format}`,
    body: out.body,
    cta: out.cta || "",
    notes: out.notes || "",
    source_brief_id: briefRow?.id || null,
    cost_usd: parseFloat((llmResult.cost_usd || 0).toFixed(6)),
    model_used: llmResult.model_used || llmResult.model_id || llmResult.model_key,
    provider_used: llmResult.provider_used || llmResult.provider,
    provider: llmResult.provider_used || llmResult.provider,
    confidence: llmResult.confidence ?? null,
    escalation_reason: llmResult.escalation_reason || null,
    cache_hit: llmResult.cache_hit === true,
  };
});

// ─── aicreator handler ───────────────────────────────────────

register("aicreator", async (payload) => {
  const {
    brand_slug,
    objective,
    output_format = "caption",
    platform = "instagram",
    audience = "",
    tone = "clear, direct, modern",
    step_count = 5,
    brief = "",
    plan_id,
    task_id,
  } = payload || {};

  if (!brand_slug) throw new Error("aicreator requires brand_slug");
  if (!objective || typeof objective !== "string") {
    throw new Error("aicreator requires objective (non-empty string)");
  }

  const brandRow = await pg.query("SELECT * FROM brands WHERE slug = $1", [brand_slug]);
  const brand = brandRow.rows[0];
  if (!brand) throw new Error(`Unknown brand_slug: "${brand_slug}"`);

  const latestBrief = await pg.query(
    `SELECT id, title, hook_pattern, script_outline, cta
     FROM content_briefs
     WHERE brand_slug = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [brand_slug]
  );
  const briefRow = latestBrief.rows[0] || null;

  const systemBase = `You are an elite content strategist and copywriter.
Return ONLY strict JSON with this schema:
{
  "strategy_summary": "string",
  "steps": [
    { "step": 1, "name": "string", "action": "string", "output": "string" }
  ],
  "content_draft": {
    "title": "string",
    "hook": "string",
    "body": "string",
    "cta": "string"
  },
  "alternatives": [
    { "angle": "string", "hook": "string", "cta": "string" }
  ],
  "qa_checklist": ["string"]
}`;
  const system = await withContentPrelude(systemBase);

  const user = [
    `Brand: ${brand.name} (${brand.slug})`,
    `Niche: ${brand.niche || "unknown"}`,
    `Target demo: ${brand.target_demo || "unknown"}`,
    `Objective: ${objective}`,
    `Output format: ${output_format}`,
    `Platform: ${platform}`,
    `Audience: ${audience || "(not provided)"}`,
    `Tone: ${tone}`,
    `Step count target: ${step_count}`,
    `User brief: ${brief || "(none)"}`,
    briefRow ? `Latest pattern: ${briefRow.hook_pattern || "(none)"}` : "Latest pattern: (none)",
    briefRow ? `Latest outline: ${briefRow.script_outline || "(none)"}` : "",
    briefRow ? `Latest CTA guidance: ${briefRow.cta || "(none)"}` : "",
  ].filter(Boolean).join("\n");

  const llmResult = await chatJson("generate_copy", system, user, {
    max_tokens: 1800,
    task_id,
    plan_id,
  });
  const out = llmResult.json || {};

  if (!out.strategy_summary || !Array.isArray(out.steps) || !out.content_draft?.body) {
    throw new Error(`aicreator returned invalid response. Raw: ${(llmResult.text || "").slice(0, 200)}`);
  }
  await contentWriteback({
    task_type: "aicreator",
    goal: `brand=${brand_slug} objective=${objective}`,
    summary: `generated strategy with ${out.steps.length} steps`,
    model_used: llmResult.model_used || llmResult.model_id || llmResult.model_key,
    cost_usd: Number(llmResult.cost_usd || 0),
  });

  return {
    brand_slug,
    objective,
    output_format,
    platform,
    strategy_summary: out.strategy_summary,
    steps: out.steps,
    content_draft: out.content_draft,
    alternatives: Array.isArray(out.alternatives) ? out.alternatives : [],
    qa_checklist: Array.isArray(out.qa_checklist) ? out.qa_checklist : [],
    source_brief_id: briefRow?.id || null,
    cost_usd: parseFloat((llmResult.cost_usd || 0).toFixed(6)),
    model_used: llmResult.model_used || llmResult.model_id || llmResult.model_key,
    provider_used: llmResult.provider_used || llmResult.provider,
    provider: llmResult.provider_used || llmResult.provider,
    confidence: llmResult.confidence ?? null,
    escalation_reason: llmResult.escalation_reason || null,
    cache_hit: llmResult.cache_hit === true,
  };
});

function normalizeChannel(channel) {
  const v = String(channel || "").trim().toLowerCase();
  const allowed = new Set(["email", "sms", "blog", "instagram", "linkedin", "push_notification"]);
  if (!allowed.has(v)) {
    throw new Error(`Invalid channel "${channel}". Use: email|sms|blog|instagram|linkedin|push_notification`);
  }
  return v;
}

async function getBrandOrThrow(brandSlug) {
  const { rows } = await pg.query("SELECT id, slug, name, niche, target_demo FROM brands WHERE slug = $1 LIMIT 1", [brandSlug]);
  if (!rows.length) throw new Error(`Unknown brand_slug: "${brandSlug}"`);
  return rows[0];
}

async function runCopyResearchPack(payload = {}) {
  const brand_slug = String(payload.brand_slug || "").trim();
  const topic = String(payload.topic || "").trim();
  if (!brand_slug) throw new Error("copy_research_pack requires brand_slug");
  if (!topic) throw new Error("copy_research_pack requires topic");

  const channel = normalizeChannel(payload.channel);
  const brand = await getBrandOrThrow(brand_slug);
  const sources = Array.isArray(payload.sources) ? payload.sources.filter(Boolean).map(String) : [];
  const target_audience = String(payload.target_audience || "").trim();
  const tone = String(payload.tone || "clear, persuasive, specific").trim();
  const goal = String(payload.goal || "").trim();
  const notebook_context = String(payload.notebook_context || "").trim();
  const persist_brief = payload.persist_brief !== false;

  const systemBase = `You are a conversion research strategist.
Return ONLY strict JSON:
{
  "research_summary": "string",
  "icp_snapshot": "string",
  "voice_guide": ["string"],
  "pain_points": ["string"],
  "objections": ["string"],
  "proof_points": ["string"],
  "offer_angles": ["string"],
  "hook_bank": ["string"],
  "cta_bank": ["string"],
  "keywords": ["string"],
  "research_questions_for_notebooklm": ["string"],
  "citation_map": [{ "claim": "string", "source": "string" }]
}`;
  const system = await withContentPrelude(systemBase);

  const user = [
    `Brand: ${brand.name} (${brand.slug})`,
    `Niche: ${brand.niche || "unknown"}`,
    `Target demo: ${brand.target_demo || "unknown"}`,
    `Channel: ${channel}`,
    `Topic: ${topic}`,
    `Audience hint: ${target_audience || "(none)"}`,
    `Tone target: ${tone}`,
    `Business goal: ${goal || "(none)"}`,
    sources.length ? `Source URLs:\n- ${sources.join("\n- ")}` : "Source URLs: (none)",
    notebook_context ? `NotebookLM notes:\n${notebook_context}` : "NotebookLM notes: (none)",
  ].join("\n");

  const llm = await chatJson("copy_research_pack", system, user, { max_tokens: 2200, json_mode: true, task_id: payload.task_id, plan_id: payload.plan_id });
  const out = llm.json || {};

  const notebooklm_packet = {
    upload_sources: sources,
    notebook_title: `${brand.name} ${channel} ${topic}`.slice(0, 120),
    prompt: [
      `Build a buyer-research notebook for ${brand.name}.`,
      `Topic: ${topic}`,
      `Find evidence-backed pain points, objections, language patterns, and purchase triggers.`,
      `Return citation-linked takeaways I can reuse in copy.`,
    ].join(" "),
    questions: Array.isArray(out.research_questions_for_notebooklm) ? out.research_questions_for_notebooklm : [],
  };

  let brief_id = null;
  if (persist_brief) {
    const r = await pg.query(
      `INSERT INTO content_briefs
         (brand_id, channel, topic, target_audience, tone, goal, reference_urls, keywords, created_by, status)
       VALUES ($1, $2::content_channel, $3, $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING id`,
      [
        brand.id,
        channel,
        topic,
        target_audience || null,
        tone || null,
        goal || null,
        sources.length ? sources : null,
        Array.isArray(out.keywords) ? out.keywords.slice(0, 20) : null,
        "copy_research_pack",
      ]
    );
    brief_id = r.rows[0]?.id || null;
  }

  await contentWriteback({
    task_type: "copy_research_pack",
    goal: `brand=${brand_slug} channel=${channel} topic=${topic}`,
    summary: `research pack generated; brief_id=${brief_id || "none"}`,
    model_used: llm.model_used || llm.model_id || llm.model_key,
    cost_usd: Number(llm.cost_usd || 0),
  });

  return {
    brand_slug,
    brief_id,
    channel,
    topic,
    notebooklm_packet,
    research: out,
    cost_usd: parseFloat((llm.cost_usd || 0).toFixed(6)),
    model_used: llm.model_used || llm.model_id || llm.model_key,
    provider_used: llm.provider_used || llm.provider,
    confidence: llm.confidence ?? null,
    cache_hit: llm.cache_hit === true,
  };
}

async function runCopyCritique(payload = {}) {
  const brand_slug = String(payload.brand_slug || "").trim();
  if (!brand_slug) throw new Error("copy_critique requires brand_slug");
  const channel = normalizeChannel(payload.channel);
  await getBrandOrThrow(brand_slug);

  let draft_text = String(payload.draft_text || "").trim();
  let draft_id = payload.draft_id || null;
  if (!draft_text && draft_id) {
    const lookup = await pg.query(
      `SELECT cd.body_md, cd.subject_line, cb.topic, cb.target_audience, cb.tone, cb.goal
       FROM content_drafts cd
       JOIN content_briefs cb ON cb.id = cd.brief_id
       WHERE cd.id = $1`,
      [draft_id]
    );
    if (lookup.rows.length) {
      const row = lookup.rows[0];
      draft_text = [row.subject_line, row.body_md].filter(Boolean).join("\n\n").trim();
      payload.topic ||= row.topic;
      payload.target_audience ||= row.target_audience;
      payload.tone ||= row.tone;
      payload.goal ||= row.goal;
    }
  }
  if (!draft_text || draft_text.length < 20) throw new Error("copy_critique requires draft_text with at least 20 characters");

  const rubric = String(payload.rubric || "clarity, specific outcomes, proof, objection handling, CTA strength, compliance").trim();
  const systemBase = `You are a senior direct-response copy chief.
Return ONLY strict JSON:
{
  "scores": {
    "clarity": 0.0,
    "offer_strength": 0.0,
    "specificity": 0.0,
    "trust": 0.0,
    "cta_strength": 0.0,
    "compliance": 0.0,
    "toxicity_risk": 0.0,
    "overall": 0.0
  },
  "wins": ["string"],
  "issues": [{ "severity": "high|medium|low", "issue": "string", "fix": "string" }],
  "rewrite_plan": ["string"]
}`;
  const system = await withContentPrelude(systemBase);

  const user = [
    `Brand slug: ${brand_slug}`,
    `Channel: ${channel}`,
    `Topic: ${payload.topic || "(none)"}`,
    `Audience: ${payload.target_audience || "(none)"}`,
    `Tone target: ${payload.tone || "(none)"}`,
    `Goal: ${payload.goal || "(none)"}`,
    `Rubric: ${rubric}`,
    `Draft:\n${draft_text}`,
  ].join("\n");

  const llm = await chatJson("copy_critique", system, user, { max_tokens: 1800, json_mode: true, task_id: payload.task_id, plan_id: payload.plan_id });
  const out = llm.json || {};
  const scores = out.scores || {};

  if (draft_id) {
    await pg.query(
      `UPDATE content_drafts SET
         score_quality = $1,
         score_relevancy = $2,
         score_toxicity = $3,
         score_compliance = $4,
         score_brand_tone = $5,
         scoring_model = $6,
         scoring_notes = $7,
         status = 'pending_review',
         updated_at = NOW()
       WHERE id = $8`,
      [
        Number(scores.overall || 0.5),
        Number(scores.specificity || 0.5),
        Number(scores.toxicity_risk || 0),
        Number(scores.compliance || 0.5),
        Number(scores.clarity || 0.5),
        llm.model_used || llm.model_id || llm.model_key || null,
        JSON.stringify(out),
        draft_id,
      ]
    );
  }

  await contentWriteback({
    task_type: "copy_critique",
    goal: `brand=${brand_slug} channel=${channel}`,
    summary: `critique generated${draft_id ? ` for draft=${draft_id}` : ""}`,
    model_used: llm.model_used || llm.model_id || llm.model_key,
    cost_usd: Number(llm.cost_usd || 0),
  });

  return {
    brand_slug,
    draft_id,
    critique: out,
    cost_usd: parseFloat((llm.cost_usd || 0).toFixed(6)),
    model_used: llm.model_used || llm.model_id || llm.model_key,
    provider_used: llm.provider_used || llm.provider,
    confidence: llm.confidence ?? null,
    cache_hit: llm.cache_hit === true,
  };
}

async function runCopyImprove(payload = {}) {
  const brand_slug = String(payload.brand_slug || "").trim();
  if (!brand_slug) throw new Error("copy_improve requires brand_slug");
  const channel = normalizeChannel(payload.channel);
  await getBrandOrThrow(brand_slug);

  const draft_text = String(payload.draft_text || "").trim();
  if (!draft_text || draft_text.length < 20) throw new Error("copy_improve requires draft_text with at least 20 characters");
  const critiqueText = typeof payload.critique === "string" ? payload.critique : JSON.stringify(payload.critique || {});
  if (!critiqueText || critiqueText === "{}") throw new Error("copy_improve requires critique");

  const systemBase = `You are a direct-response conversion copywriter.
Use critique notes to improve the draft without changing core offer facts.
Return ONLY strict JSON:
{
  "subject_line": "string",
  "preview_text": "string",
  "headline": "string",
  "body_md": "string",
  "cta_text": "string",
  "change_log": ["string"],
  "quality_delta_estimate": 0.0
}`;
  const system = await withContentPrelude(systemBase);

  const user = [
    `Brand slug: ${brand_slug}`,
    `Channel: ${channel}`,
    `Topic: ${payload.topic || "(none)"}`,
    `Audience: ${payload.target_audience || "(none)"}`,
    `Tone: ${payload.tone || "(none)"}`,
    `Goal: ${payload.goal || "(none)"}`,
    `Iteration: ${Number(payload.iteration || 1)}`,
    `Original draft:\n${draft_text}`,
    `Critique:\n${critiqueText}`,
  ].join("\n");

  const llm = await chatJson("copy_improve", system, user, { max_tokens: 2000, json_mode: true, task_id: payload.task_id, plan_id: payload.plan_id });
  const out = llm.json || {};

  let improved_draft_id = null;
  if (payload.draft_id) {
    const src = await pg.query("SELECT brief_id FROM content_drafts WHERE id = $1", [payload.draft_id]);
    const brief_id = src.rows[0]?.brief_id || null;
    if (brief_id) {
      const nextVariantRes = await pg.query("SELECT COALESCE(MAX(variant_number), 0) + 1 AS n FROM content_drafts WHERE brief_id = $1", [brief_id]);
      const variant_number = Number(nextVariantRes.rows[0]?.n || 1);
      const ins = await pg.query(
        `INSERT INTO content_drafts
           (brief_id, variant_number, model_used, prompt_version, body_md, subject_line, preview_text, headline, cta_text, scoring_notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_review')
         RETURNING id`,
        [
          brief_id,
          variant_number,
          llm.model_used || llm.model_id || llm.model_key || null,
          "copy_improve_v1",
          out.body_md || draft_text,
          out.subject_line || null,
          out.preview_text || null,
          out.headline || null,
          out.cta_text || null,
          JSON.stringify({
            source_draft_id: payload.draft_id,
            critique: payload.critique,
            change_log: out.change_log || [],
            quality_delta_estimate: out.quality_delta_estimate ?? null,
          }),
        ]
      );
      improved_draft_id = ins.rows[0]?.id || null;
    }
  }

  await contentWriteback({
    task_type: "copy_improve",
    goal: `brand=${brand_slug} channel=${channel}`,
    summary: `improved draft generated${improved_draft_id ? ` improved_draft_id=${improved_draft_id}` : ""}`,
    model_used: llm.model_used || llm.model_id || llm.model_key,
    cost_usd: Number(llm.cost_usd || 0),
  });

  return {
    brand_slug,
    channel,
    improved: out,
    improved_draft_id,
    cost_usd: parseFloat((llm.cost_usd || 0).toFixed(6)),
    model_used: llm.model_used || llm.model_id || llm.model_key,
    provider_used: llm.provider_used || llm.provider,
    confidence: llm.confidence ?? null,
    cache_hit: llm.cache_hit === true,
  };
}

async function runWebsiteContentGenerator(payload = {}) {
  const brand_slug = String(payload.brand_slug || "").trim();
  if (!brand_slug) throw new Error("website_content_generator requires brand_slug");
  const brand = await getBrandOrThrow(brand_slug);

  const market = String(payload.market || "").trim();
  const objective = String(payload.objective || "").trim();
  const industry = String(payload.industry || "").trim().toLowerCase();
  const page_type = String(payload.page_type || "").trim().toLowerCase();
  if (!market) throw new Error("website_content_generator requires market");
  if (!objective) throw new Error("website_content_generator requires objective");

  const validIndustries = new Set(["health_brand", "saas", "general"]);
  const validPageTypes = new Set(["homepage", "landing_page", "service_page", "product_page"]);
  if (!validIndustries.has(industry)) throw new Error(`website_content_generator invalid industry "${industry}"`);
  if (!validPageTypes.has(page_type)) throw new Error(`website_content_generator invalid page_type "${page_type}"`);

  const target_audience = String(payload.target_audience || "").trim();
  const tone = String(payload.tone || "clear, trustworthy, specific").trim();
  const reading_level = String(payload.reading_level || "grade_8_to_10").trim();
  const primary_keyword = String(payload.primary_keyword || "").trim();
  const secondary_keywords = Array.isArray(payload.secondary_keywords) ? payload.secondary_keywords.filter(Boolean).map(String) : [];
  const competitors = Array.isArray(payload.competitors) ? payload.competitors.filter(Boolean).map(String) : [];
  const compliance_region = String(payload.compliance_region || "US").trim();
  const notebook_context = String(payload.notebook_context || "").trim();
  const sources = Array.isArray(payload.sources) ? payload.sources.filter(Boolean).map(String) : [];

  const researchSystemBase = `You are a market strategist for high-conversion website content.
Return ONLY strict JSON:
{
  "market_snapshot": {
    "icp_summary": "string",
    "demographics": ["string"],
    "psychographics": ["string"],
    "pain_points": ["string"],
    "desired_outcomes": ["string"],
    "purchase_objections": ["string"],
    "trust_triggers": ["string"],
    "search_intent_map": ["string"]
  },
  "seo_aeo_strategy": {
    "primary_keyword": "string",
    "secondary_keywords": ["string"],
    "semantic_entities": ["string"],
    "faq_questions": ["string"],
    "serp_angle": "string",
    "answer_engine_notes": ["string"]
  },
  "compliance_guardrails": {
    "must_include": ["string"],
    "must_avoid": ["string"],
    "required_disclaimers": ["string"]
  },
  "positioning": {
    "value_prop": "string",
    "offer_angle": "string",
    "proof_plan": ["string"]
  }
}`;
  const researchSystem = await withContentPrelude(researchSystemBase);
  const researchUser = [
    `Brand: ${brand.name} (${brand.slug})`,
    `Niche: ${brand.niche || "unknown"}`,
    `Target demo: ${brand.target_demo || "unknown"}`,
    `Industry mode: ${industry}`,
    `Page type: ${page_type}`,
    `Market: ${market}`,
    `Objective: ${objective}`,
    `Audience hint: ${target_audience || "(none)"}`,
    `Tone target: ${tone}`,
    `Reading level: ${reading_level}`,
    `Primary keyword hint: ${primary_keyword || "(none)"}`,
    secondary_keywords.length ? `Secondary keywords: ${secondary_keywords.join(", ")}` : "Secondary keywords: (none)",
    competitors.length ? `Competitors: ${competitors.join(", ")}` : "Competitors: (none)",
    `Compliance region: ${compliance_region}`,
    sources.length ? `Source URLs:\n- ${sources.join("\n- ")}` : "Source URLs: (none)",
    notebook_context ? `NotebookLM notes:\n${notebook_context}` : "NotebookLM notes: (none)",
  ].join("\n");

  const researchLlm = await chatJson("website_content_generator", researchSystem, researchUser, {
    max_tokens: 2400,
    json_mode: true,
    task_id: payload.task_id,
    plan_id: payload.plan_id,
  });
  const research = researchLlm.json || {};

  const pageSystemBase = `You are a senior conversion copywriter and information architect.
Produce a complete website page draft that is SEO-ready, AEO-ready, and compliance-aware.
Return ONLY strict JSON:
{
  "page": {
    "title_tag": "string",
    "meta_description": "string",
    "slug_suggestion": "string",
    "h1": "string",
    "hero_subhead": "string",
    "primary_cta": "string",
    "secondary_cta": "string",
    "sections": [
      { "heading": "string", "purpose": "string", "copy": "string" }
    ],
    "faq": [
      { "q": "string", "a": "string" }
    ],
    "schema_suggestions": ["FAQPage|Product|Service|Organization"],
    "internal_link_ideas": ["string"]
  },
  "conversion_system": {
    "psychology_principles_used": ["string"],
    "nlp_patterns_used": ["string"],
    "trust_elements_to_add": ["string"],
    "ab_test_ideas": ["string"]
  },
  "compliance_review": {
    "risk_level": "low|medium|high",
    "flagged_phrases": ["string"],
    "required_disclaimers": ["string"],
    "safe_alternatives": ["string"]
  },
  "next_assets": {
    "social_teasers": ["string"],
    "email_angles": ["string"]
  }
}`;
  const pageSystem = await withContentPrelude(pageSystemBase);
  const pageUser = [
    `Brand: ${brand.name} (${brand.slug})`,
    `Industry: ${industry}`,
    `Page type: ${page_type}`,
    `Market: ${market}`,
    `Objective: ${objective}`,
    `Tone: ${tone}`,
    `Reading level: ${reading_level}`,
    `Compliance region: ${compliance_region}`,
    `Use this research JSON as source of truth:\n${JSON.stringify(research).slice(0, 12000)}`,
  ].join("\n\n");

  const pageLlm = await chatJson("website_content_generator", pageSystem, pageUser, {
    max_tokens: 3200,
    json_mode: true,
    task_id: payload.task_id,
    plan_id: payload.plan_id,
  });
  const website = pageLlm.json || {};

  if (!website?.page?.h1 || !Array.isArray(website?.page?.sections) || website.page.sections.length === 0) {
    throw new Error("website_content_generator produced invalid website structure");
  }

  const totalCost = Number(researchLlm.cost_usd || 0) + Number(pageLlm.cost_usd || 0);
  await contentWriteback({
    task_type: "website_content_generator",
    goal: `brand=${brand_slug} market=${market} page_type=${page_type}`,
    summary: `website draft generated with ${website.page.sections.length} sections`,
    learned: Array.isArray(research?.market_snapshot?.pain_points)
      ? `pain_points=${research.market_snapshot.pain_points.slice(0, 3).join("; ")}`
      : "",
    model_used: pageLlm.model_used || pageLlm.model_id || pageLlm.model_key,
    cost_usd: totalCost,
    open_loops: ["human legal/compliance review before publishing"],
  });

  return {
    brand_slug,
    market,
    objective,
    industry,
    page_type,
    research,
    website,
    cost_usd: Number(totalCost.toFixed(6)),
    model_used: pageLlm.model_used || pageLlm.model_id || pageLlm.model_key,
    provider_used: pageLlm.provider_used || pageLlm.provider,
    confidence: pageLlm.confidence ?? researchLlm.confidence ?? null,
    cache_hit: pageLlm.cache_hit === true,
  };
}

async function runSocialMediaCopywriter(payload = {}) {
  const brand_slug = String(payload.brand_slug || "").trim();
  if (!brand_slug) throw new Error("social_media_copywriter requires brand_slug");
  const brand = await getBrandOrThrow(brand_slug);

  const platform = String(payload.platform || "").trim().toLowerCase();
  const topic = String(payload.topic || "").trim();
  if (!platform) throw new Error("social_media_copywriter requires platform");
  if (!topic) throw new Error("social_media_copywriter requires topic");

  const validPlatforms = new Set(["instagram", "x", "linkedin", "tiktok", "facebook"]);
  if (!validPlatforms.has(platform)) throw new Error(`social_media_copywriter invalid platform "${platform}"`);

  const objective = String(payload.objective || "engagement_and_clicks").trim();
  const tone = String(payload.tone || "direct, clear, compelling").trim();
  const target_audience = String(payload.target_audience || "").trim();
  const primary_keyword = String(payload.primary_keyword || "").trim();
  const compliance_mode = String(payload.compliance_mode || "standard").trim().toLowerCase();
  const variations = Math.max(1, Math.min(5, Number(payload.variations || 3)));
  const website_context = String(payload.website_context || "").trim();

  const systemBase = `You are a social media direct-response copywriter.
Return ONLY strict JSON:
{
  "strategy": {
    "angle": "string",
    "hook_principles": ["string"],
    "cta_strategy": "string"
  },
  "posts": [
    {
      "variation": 1,
      "hook": "string",
      "body": "string",
      "cta": "string",
      "hashtags": ["string"],
      "aeo_friendly_answer_snippet": "string",
      "compliance_notes": ["string"]
    }
  ]
}`;
  const system = await withContentPrelude(systemBase);
  const user = [
    `Brand: ${brand.name} (${brand.slug})`,
    `Platform: ${platform}`,
    `Topic: ${topic}`,
    `Objective: ${objective}`,
    `Tone: ${tone}`,
    `Target audience: ${target_audience || "(none)"}`,
    `Primary keyword: ${primary_keyword || "(none)"}`,
    `Compliance mode: ${compliance_mode}`,
    `Variations requested: ${variations}`,
    website_context ? `Website context:\n${website_context}` : "Website context: (none)",
  ].join("\n");

  const llm = await chatJson("social_media_copywriter", system, user, {
    max_tokens: 2200,
    json_mode: true,
    task_id: payload.task_id,
    plan_id: payload.plan_id,
  });
  const out = llm.json || {};
  if (!Array.isArray(out.posts) || out.posts.length === 0) {
    throw new Error("social_media_copywriter returned no posts");
  }

  await contentWriteback({
    task_type: "social_media_copywriter",
    goal: `brand=${brand_slug} platform=${platform} topic=${topic}`,
    summary: `generated ${out.posts.length} social variation(s)`,
    model_used: llm.model_used || llm.model_id || llm.model_key,
    cost_usd: Number(llm.cost_usd || 0),
  });

  return {
    brand_slug,
    platform,
    topic,
    strategy: out.strategy || {},
    posts: out.posts.slice(0, variations),
    cost_usd: parseFloat((llm.cost_usd || 0).toFixed(6)),
    model_used: llm.model_used || llm.model_id || llm.model_key,
    provider_used: llm.provider_used || llm.provider,
    confidence: llm.confidence ?? null,
    cache_hit: llm.cache_hit === true,
  };
}

register("copy_research_pack", async (payload) => runCopyResearchPack(payload));

register("copy_critique", async (payload) => runCopyCritique(payload));

register("copy_improve", async (payload) => runCopyImprove(payload));

register("copy_lab_run", async (payload) => {
  const iterations = Math.max(1, Math.min(3, Number(payload?.iterations || 2)));
  const research = await runCopyResearchPack(payload || {});

  const generateSystemBase = `You are a high-conversion copywriter using research evidence.
Return ONLY strict JSON:
{
  "subject_line": "string",
  "preview_text": "string",
  "headline": "string",
  "body_md": "string",
  "cta_text": "string"
}`;
  const generateSystem = await withContentPrelude(generateSystemBase);

  const generateUser = [
    `Brand: ${payload.brand_slug}`,
    `Channel: ${payload.channel}`,
    `Topic: ${payload.topic}`,
    `Audience: ${payload.target_audience || "(none)"}`,
    `Tone: ${payload.tone || "clear, persuasive, specific"}`,
    `Goal: ${payload.goal || "(none)"}`,
    `Research summary: ${research.research?.research_summary || "(none)"}`,
    `Pain points: ${(research.research?.pain_points || []).join("; ")}`,
    `Objections: ${(research.research?.objections || []).join("; ")}`,
    `Proof points: ${(research.research?.proof_points || []).join("; ")}`,
    `Offer angles: ${(research.research?.offer_angles || []).join("; ")}`,
    `Hook bank: ${(research.research?.hook_bank || []).join("; ")}`,
    `CTA bank: ${(research.research?.cta_bank || []).join("; ")}`,
  ].join("\n");

  const firstDraftLlm = await chatJson("generate_copy", generateSystem, generateUser, {
    max_tokens: 1900,
    json_mode: true,
    task_id: payload.task_id,
    plan_id: payload.plan_id,
  });
  let currentDraft = firstDraftLlm.json || {};
  let critique = null;

  for (let i = 1; i <= iterations; i++) {
    critique = await runCopyCritique({
      ...payload,
      draft_text: currentDraft.body_md || currentDraft.body || "",
      topic: payload.topic,
      target_audience: payload.target_audience,
      tone: payload.tone,
      goal: payload.goal,
      rubric: payload.rubric,
      task_id: payload.task_id,
      plan_id: payload.plan_id,
    });
    const improved = await runCopyImprove({
      ...payload,
      draft_text: currentDraft.body_md || currentDraft.body || "",
      critique: critique.critique,
      topic: payload.topic,
      target_audience: payload.target_audience,
      tone: payload.tone,
      goal: payload.goal,
      iteration: i,
      task_id: payload.task_id,
      plan_id: payload.plan_id,
    });
    currentDraft = improved.improved || currentDraft;
  }

  await contentWriteback({
    task_type: "copy_lab_run",
    goal: `brand=${payload.brand_slug} channel=${payload.channel} topic=${payload.topic}`,
    summary: `completed ${iterations} critique/improve iteration(s)`,
    model_used: firstDraftLlm.model_used || firstDraftLlm.model_id || firstDraftLlm.model_key,
    cost_usd: Number((research.cost_usd || 0) + (firstDraftLlm.cost_usd || 0) + (critique?.cost_usd || 0)),
    open_loops: ["human review required before publish"],
  });

  return {
    brand_slug: payload.brand_slug,
    channel: payload.channel,
    topic: payload.topic,
    brief_id: research.brief_id || null,
    notebooklm_packet: research.notebooklm_packet,
    research: research.research,
    final_draft: currentDraft,
    final_critique: critique?.critique || null,
    iterations,
    model_used: firstDraftLlm.model_used || firstDraftLlm.model_id || firstDraftLlm.model_key,
    provider_used: firstDraftLlm.provider_used || firstDraftLlm.provider,
    total_cost_usd_est: Number((research.cost_usd || 0) + (firstDraftLlm.cost_usd || 0) + (critique?.cost_usd || 0)).toFixed(6),
  };
});

register("website_content_generator", async (payload) => runWebsiteContentGenerator(payload));

register("social_media_copywriter", async (payload) => runSocialMediaCopywriter(payload));
