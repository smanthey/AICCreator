#!/usr/bin/env node
"use strict";
/**
 * youtube-transcript-visual-index
 * ------------------------------
 * Standalone, OpenClaw-free indexing utility:
 * - gathers transcript signals
 * - gathers visual keyshot signals (when tooling exists)
 * - computes a practical quality benchmark per video
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const https = require("https");

function hasBinary(name) {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(bin, args, opts = {}) {
  return execFileSync(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: opts.encoding || "utf8",
    maxBuffer: opts.maxBuffer || 32 * 1024 * 1024,
  });
}

function parseArgs(argv) {
  const out = { urls: [], urlsFile: null, out: null, keyshots: 6, scene: 0.4, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") out.urls.push(String(argv[++i] || "").trim());
    else if (a === "--urls-file") out.urlsFile = String(argv[++i] || "").trim();
    else if (a === "--out") out.out = String(argv[++i] || "").trim();
    else if (a === "--keyshots") out.keyshots = Math.max(1, Math.min(24, Number(argv[++i] || 6) || 6));
    else if (a === "--scene") out.scene = Math.max(0.1, Math.min(0.95, Number(argv[++i] || 0.4) || 0.4));
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function parseVideoId(urlOrId) {
  const raw = String(urlOrId || "").trim();
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtu.be")) return (u.pathname || "").replace(/^\//, "").slice(0, 11);
    if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
    const m = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    return null;
  } catch {
    return null;
  }
}

function readUrls(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#"));
}

function parseVtt(vtt) {
  const lines = String(vtt || "").split(/\r?\n/g);
  const segments = [];
  let current = null;
  for (const line of lines) {
    if (!line.trim() || /^WEBVTT/i.test(line.trim()) || /^NOTE/i.test(line.trim())) continue;
    if (line.includes("-->") && /^\d/.test(line.trim())) {
      if (current && current.text) segments.push(current);
      const parts = line.split("-->").map((p) => p.trim());
      current = { start: parts[0], end: parts[1], text: "" };
      continue;
    }
    if (!current) continue;
    current.text = `${current.text} ${line.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`.trim();
  }
  if (current && current.text) segments.push(current);
  return segments;
}

function uniqWords(text, max = 30) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "you", "your", "have", "are", "was", "will", "they", "them"]);
  const freq = new Map();
  for (const t of String(text || "").toLowerCase().split(/[^a-z0-9]+/g)) {
    if (!t || t.length < 3 || stop.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

function fetchCaptionViaTimedText(videoId) {
  const urls = [
    `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}&fmt=vtt`,
    `https://www.youtube.com/api/timedtext?lang=en&kind=asr&v=${videoId}&fmt=vtt`,
  ];

  return new Promise((resolve) => {
    const tryOne = (idx) => {
      if (idx >= urls.length) return resolve(null);
      https
        .get(urls[idx], { headers: { "User-Agent": "claw-architect-yt-indexer/1.0" } }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d) => (body += d));
          res.on("end", () => {
            if (res.statusCode === 200 && body && body.includes("-->")) return resolve(body);
            return tryOne(idx + 1);
          });
        })
        .on("error", () => tryOne(idx + 1));
    };
    tryOne(0);
  });
}

function collectMetadata(url) {
  // yt-dlp JSON is our highest-fidelity metadata path and stays stable across most YouTube surface changes.
  const raw = run("yt-dlp", ["-J", "--skip-download", url]);
  const j = JSON.parse(raw);
  return {
    id: j.id || null,
    title: j.title || null,
    channel: j.channel || j.uploader || null,
    duration: j.duration || null,
    view_count: j.view_count || null,
    like_count: j.like_count || null,
    upload_date: j.upload_date || null,
    webpage_url: j.webpage_url || url,
    thumbnail: j.thumbnail || null,
    tags: Array.isArray(j.tags) ? j.tags.slice(0, 40) : [],
  };
}

function extractTranscriptWithYtDlp(url, tempDir, videoId) {
  run("yt-dlp", [
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs", "en.*,en",
    "--sub-format", "vtt",
    "-o", path.join(tempDir, "%(id)s.%(ext)s"),
    url,
  ]);
  const files = fs.readdirSync(tempDir).filter((f) => f.startsWith(videoId) && f.endsWith(".vtt"));
  if (!files.length) return null;
  const candidate = files.find((f) => /\.en\./.test(f)) || files[0];
  return fs.readFileSync(path.join(tempDir, candidate), "utf8");
}

function createKeyshots(url, tempDir, videoId, scene, maxFrames) {
  // Keep extraction window short for predictable run time and disk usage.
  const outPattern = path.join(tempDir, "video.%(ext)s");
  run("yt-dlp", ["--download-sections", "*0-90", "-f", "bv*[height<=480]+ba/b[height<=480]/b", "-o", outPattern, url]);
  const video = fs.readdirSync(tempDir)
    .map((f) => path.join(tempDir, f))
    .find((f) => fs.statSync(f).isFile() && /video\.(mp4|webm|mkv)$/i.test(path.basename(f)));
  if (!video) return [];

  const shotPattern = path.join(tempDir, `${videoId}_shot_%03d.jpg`);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", video,
    "-vf", `select='gt(scene,${scene})',scale=640:-1`,
    "-vsync", "vfr",
    "-frames:v", String(maxFrames),
    shotPattern,
  ]);

  return fs.readdirSync(tempDir)
    .filter((f) => f.startsWith(`${videoId}_shot_`) && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(tempDir, f));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.join(__dirname, "..");
  const urlsFile = args.urlsFile || path.join(root, "data", "youtube-urls.txt");
  const outPath = args.out || path.join(root, "reports", "youtube-transcript-visual-index-latest.json");
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  const inputUrls = [...args.urls, ...readUrls(urlsFile)];
  const dedup = [...new Set(inputUrls.map((u) => u.trim()).filter(Boolean))];
  const targets = dedup.map((u) => ({ url: u, videoId: parseVideoId(u) })).filter((x) => !!x.videoId);

  const ytdlp = hasBinary("yt-dlp");
  const ffmpeg = hasBinary("ffmpeg");

  if (!targets.length) throw new Error("No valid YouTube URLs or IDs found.");
  if (!ytdlp && !args.dryRun) {
    throw new Error("yt-dlp is required for full indexing. Install it or run --dry-run.");
  }

  const rows = [];
  for (const t of targets) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ytidx-${t.videoId}-`));
    try {
      const metadata = ytdlp ? collectMetadata(t.url) : { id: t.videoId, webpage_url: t.url };

      let transcriptVtt = null;
      if (ytdlp && !args.dryRun) {
        try { transcriptVtt = extractTranscriptWithYtDlp(t.url, tempDir, t.videoId); } catch {}
      }
      if (!transcriptVtt) {
        transcriptVtt = await fetchCaptionViaTimedText(t.videoId);
      }

      const transcriptSegments = parseVtt(transcriptVtt || "");
      const transcriptText = transcriptSegments.map((s) => s.text).join(" ").trim();
      const keyPhrases = uniqWords(transcriptText, 24);

      const keyshots = (!args.dryRun && ytdlp && ffmpeg && args.keyshots > 0)
        ? createKeyshots(t.url, tempDir, t.videoId, args.scene, args.keyshots)
        : [];

      const visualSignals = {
        keyshot_count: keyshots.length,
        keyshots,
        thumbnail: metadata.thumbnail || null,
        has_visual_extract: keyshots.length > 0,
      };

      const transcriptSignals = {
        has_transcript: transcriptSegments.length > 0,
        segment_count: transcriptSegments.length,
        text_chars: transcriptText.length,
        top_terms: keyPhrases,
      };

      // Weighted for real-world utility: transcript completeness matters most, visuals are next.
      const benchmark = {
        quality_score: Math.round((
          (transcriptSignals.has_transcript ? 55 : 0)
          + Math.min(25, transcriptSignals.segment_count / 6)
          + Math.min(20, visualSignals.keyshot_count * 4)
        ) * 100) / 100,
        gates: {
          transcript_present: transcriptSignals.has_transcript,
          visuals_present: visualSignals.has_visual_extract,
        },
      };

      rows.push({
        video_id: t.videoId,
        url: metadata.webpage_url || t.url,
        metadata,
        transcript: {
          ...transcriptSignals,
          segments: transcriptSegments.slice(0, 500),
        },
        visual: visualSignals,
        benchmark,
      });
    } catch (err) {
      rows.push({ video_id: t.videoId, url: t.url, error: String(err.message || err) });
    } finally {
      try {
        for (const f of fs.readdirSync(tempDir)) {
          const abs = path.join(tempDir, f);
          if (fs.statSync(abs).isFile()) fs.unlinkSync(abs);
        }
        fs.rmdirSync(tempDir);
      } catch {}
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    source_mode: { ytdlp, ffmpeg, dry_run: args.dryRun },
    counts: {
      requested: targets.length,
      indexed: rows.filter((r) => !r.error).length,
      failed: rows.filter((r) => !!r.error).length,
      with_transcript: rows.filter((r) => r.transcript?.has_transcript).length,
      with_visuals: rows.filter((r) => r.visual?.has_visual_extract).length,
    },
    top_ranked: rows
      .filter((r) => !r.error)
      .sort((a, b) => (b.benchmark?.quality_score || 0) - (a.benchmark?.quality_score || 0))
      .slice(0, 10)
      .map((r) => ({ video_id: r.video_id, title: r.metadata?.title || null, quality_score: r.benchmark?.quality_score || 0 })),
  };

  const payload = { summary, rows };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`youtube_transcript_visual_index complete: ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`youtube_transcript_visual_index failed: ${err.message}`);
  process.exit(1);
});
