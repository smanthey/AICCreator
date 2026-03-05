#!/usr/bin/env node
"use strict";

/**
 * content-creator-critique.js
 * Critique the latest content-creator brief (VIDEO-SPEC or content-creator-brief-latest.json).
 * Writes reports/content-creator-critique-latest.json with checklist scores and suggested improvements.
 * Use after content-creator:pipeline for dogfooding and improve-from-feedback loop.
 *
 * Usage: node scripts/content-creator-critique.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");
const SPEC_MD = path.join(ROOT, "docs", "INAYAN-BUILDER-VIDEO-SPEC.md");
const BRIEF_JSON = path.join(REPORTS, "content-creator-brief-latest.json");
const OUT_JSON = path.join(REPORTS, "content-creator-critique-latest.json");

function hasContent(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function critiqueFromMarkdown() {
  if (!fs.existsSync(SPEC_MD)) {
    return { ok: false, error: "missing_spec", path: SPEC_MD, scores: {}, suggestions: ["Run content-creator:pipeline to generate docs/INAYAN-BUILDER-VIDEO-SPEC.md"] };
  }
  const raw = fs.readFileSync(SPEC_MD, "utf8");
  const lines = raw.split("\n");
  let hasGoal = false;
  let hasSteps = false;
  let hasSourceVideos = false;
  let hasFeatures = false;
  let wordCount = raw.split(/\s+/).filter(Boolean).length;

  const fullLower = raw.toLowerCase();
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("goal") && (line.length > 10 || line.trim() === "## goal")) hasGoal = true;
    if (lower.includes("step") || /^\s*[\d\-*]\.\s+.+/.test(line)) hasSteps = true;
    if (lower.includes("video") && (lower.includes("http") || lower.includes("id="))) hasSourceVideos = true;
    if (lower.includes("feature") || lower.includes("capability")) hasFeatures = true;
  }
  // Table with video IDs or youtu.be links counts as source videos
  if (!hasSourceVideos && (fullLower.includes("youtu.be") || fullLower.includes("video id") || /\|[a-z0-9_-]{8,}\s*\|/i.test(raw))) hasSourceVideos = true;
  if (!hasGoal && (fullLower.includes("## goal") || fullLower.includes("build and ship"))) hasGoal = true;

  const suggestions = [];
  if (!hasGoal) suggestions.push("Add a clear goal or objective section to the brief.");
  if (!hasSteps) suggestions.push("Add numbered or bullet steps for execution.");
  if (!hasSourceVideos) suggestions.push("Reference source video URLs or IDs in the brief.");
  if (wordCount < 100) suggestions.push("Expand the brief for better copy generation (target 100+ words).");

  const scores = {
    has_goal: hasGoal ? 1 : 0,
    has_steps: hasSteps ? 1 : 0,
    has_source_videos: hasSourceVideos ? 1 : 0,
    has_features_section: hasFeatures ? 1 : 0,
    word_count: wordCount,
    total_checklist: (hasGoal ? 1 : 0) + (hasSteps ? 1 : 0) + (hasSourceVideos ? 1 : 0) + (hasFeatures ? 1 : 0),
  };
  const total = scores.total_checklist;
  const max = 4;
  return {
    ok: true,
    source: "markdown",
    path: SPEC_MD,
    scores: { ...scores, score_fraction: `${total}/${max}` },
    suggestions,
    ready_for_copy: total >= 3 && wordCount >= 50,
  };
}

function critiqueFromJson() {
  if (!fs.existsSync(BRIEF_JSON)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(BRIEF_JSON, "utf8"));
    const goal = data.goal || data.objective || "";
    const steps = Array.isArray(data.steps) ? data.steps : (data.steps_text ? [data.steps_text] : []);
    const sources = data.source_video_ids || data.video_ids || [];
    const hasGoal = hasContent(goal);
    const hasSteps = steps.length > 0 || hasContent(data.steps_text);
    const hasSourceVideos = Array.isArray(sources) && sources.length > 0;
    const hasFeatures = Array.isArray(data.features) && data.features.length > 0 || hasContent(data.features_text);

    const suggestions = [];
    if (!hasGoal) suggestions.push("Add goal/objective to the brief JSON.");
    if (!hasSteps) suggestions.push("Add steps array or steps_text.");
    if (!hasSourceVideos) suggestions.push("Add source_video_ids or video_ids.");
    if (!hasFeatures) suggestions.push("Add features or features_text.");

    const total = (hasGoal ? 1 : 0) + (hasSteps ? 1 : 0) + (hasSourceVideos ? 1 : 0) + (hasFeatures ? 1 : 0);
    return {
      ok: true,
      source: "json",
      path: BRIEF_JSON,
      scores: {
        has_goal: hasGoal ? 1 : 0,
        has_steps: hasSteps ? 1 : 0,
        has_source_videos: hasSourceVideos ? 1 : 0,
        has_features_section: hasFeatures ? 1 : 0,
        total_checklist: total,
        score_fraction: `${total}/4`,
      },
      suggestions,
      ready_for_copy: total >= 3,
    };
  } catch (e) {
    return { ok: false, error: "invalid_json", path: BRIEF_JSON, message: e.message };
  }
}

function main() {
  let result = critiqueFromJson();
  if (!result || !result.ok) result = critiqueFromMarkdown();

  const report = {
    generated_at: new Date().toISOString(),
    brief_path: result.path,
    source: result.source || "none",
    scores: result.scores || {},
    suggestions: result.suggestions || [],
    ready_for_copy: result.ready_for_copy || false,
    error: result.error || null,
  };

  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  console.log("[content-creator-critique] Wrote", OUT_JSON);
  console.log("[content-creator-critique] Scores:", report.scores);
  console.log("[content-creator-critique] Ready for copy:", report.ready_for_copy);
  if (report.suggestions.length) {
    console.log("[content-creator-critique] Suggestions:");
    report.suggestions.forEach((s) => console.log("  -", s));
  }
  process.exit(result.ok ? 0 : 1);
}

main();
