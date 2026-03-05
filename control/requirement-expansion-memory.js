"use strict";

/**
 * SQLite-backed memory for requirement expansion context.
 * Used by the context expansion completeness gate: read artifact here first, refuse blueprint unless all required sections filled.
 * @module control/requirement-expansion-memory
 */

const path = require("path");
const fs = require("fs");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "requirement-expansion-memory.sqlite");

let _db = null;

function getDb(dbPath) {
  const resolved = path.resolve(dbPath || DEFAULT_DB_PATH);
  if (_db) return _db;
  try {
    const Database = require("better-sqlite3");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    _db = new Database(resolved);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS expansion_context (
        project_id TEXT PRIMARY KEY,
        artifact_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    return _db;
  } catch (e) {
    if (e.code === "MODULE_NOT_FOUND") {
      throw new Error("requirement-expansion-memory requires better-sqlite3. Run: npm install better-sqlite3");
    }
    throw e;
  }
}

/**
 * Get the stored expansion artifact for a project. Returns null if not found.
 * @param {string} projectId - Project key (e.g. "default", "inayan", repo name).
 * @param {{ dbPath?: string }} options
 * @returns {object|null} Artifact or null.
 */
function get(projectId, options = {}) {
  const db = getDb(options.dbPath);
  const row = db.prepare("SELECT artifact_json FROM expansion_context WHERE project_id = ?").get(projectId || "default");
  if (!row) return null;
  try {
    return JSON.parse(row.artifact_json);
  } catch {
    return null;
  }
}

/**
 * Store expansion artifact for a project. Overwrites existing.
 * @param {string} projectId
 * @param {object} artifact - Full expansion/blueprint artifact (must include required sections for gate to pass).
 * @param {{ dbPath?: string }} options
 */
function set(projectId, artifact, options = {}) {
  const db = getDb(options.dbPath);
  const json = JSON.stringify(artifact || {});
  db.prepare(
    "INSERT INTO expansion_context (project_id, artifact_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(project_id) DO UPDATE SET artifact_json = excluded.artifact_json, updated_at = datetime('now')"
  ).run(projectId || "default", json);
}

/**
 * Close the database handle (for tests or process exit). Idempotent.
 */
function close() {
  if (_db) {
    try {
      _db.close();
    } catch (_) {}
    _db = null;
  }
}

module.exports = {
  DEFAULT_DB_PATH,
  get,
  set,
  getDb,
  close,
};
