"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { register } = require("./registry");
const { getReportDefinition, latestArtifactForReport } = require("../control/report-registry");

const ROOT = path.join(__dirname, "..");

function tailLines(s, maxLines = 40, maxChars = 12000) {
  const txt = String(s || "");
  if (!txt) return "";
  const capped = txt.slice(-maxChars);
  const lines = capped.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

register("report_refresh", async (payload = {}) => {
  const reportId = String(payload.report_id || "").trim();
  if (!reportId) throw new Error("report_refresh requires payload.report_id");

  const def = getReportDefinition(reportId);
  if (!def) throw new Error(`Unknown report_id: ${reportId}`);

  const timeoutMs = Math.max(
    60_000,
    Math.min(45 * 60_000, Number(payload.timeout_ms || process.env.REPORT_REFRESH_TIMEOUT_MS || 20 * 60_000))
  );

  const beforeArtifact = latestArtifactForReport(def);
  const startedAt = new Date().toISOString();

  const run = spawnSync("bash", ["-lc", def.refreshCommand], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });

  const afterArtifact = latestArtifactForReport(def);
  const completedAt = new Date().toISOString();

  const stdoutTail = tailLines(run.stdout);
  const stderrTail = tailLines(run.stderr);

  if (run.status !== 0) {
    throw new Error(
      [
        `report_refresh failed: ${reportId}`,
        `command=${def.refreshCommand}`,
        `status=${run.status}`,
        stderrTail || stdoutTail || "no output",
      ].join(" | ")
    );
  }

  const artifactPath = afterArtifact?.abs || null;
  const artifactUpdated = Boolean(
    afterArtifact && (!beforeArtifact || afterArtifact.mtimeMs >= beforeArtifact.mtimeMs)
  );

  return {
    ok: true,
    report_id: reportId,
    report_name: def.name,
    lane: def.lane,
    command: def.refreshCommand,
    started_at: startedAt,
    completed_at: completedAt,
    artifact_path: artifactPath,
    artifact_updated: artifactUpdated,
    stdout_tail: stdoutTail,
    stderr_tail: stderrTail,
    cost_usd: 0,
    model_used: "deterministic-report-refresh",
  };
});
