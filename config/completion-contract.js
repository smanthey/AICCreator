"use strict";

/**
 * Completion contract: evaluate a repo-completion gap record against an archetype capability pack.
 * Contract satisfied iff for the archetype's required_sections every section is complete,
 * and issues.length === 0 and next_actions.length === 0.
 * @module config/completion-contract
 */

const fs = require("fs");
const path = require("path");

const PACKS_PATH = path.join(__dirname, "archetype-capability-packs.json");

let _packs = null;

function loadPacks() {
  if (_packs) return _packs;
  try {
    const raw = fs.readFileSync(PACKS_PATH, "utf8");
    _packs = JSON.parse(raw);
    return _packs;
  } catch (e) {
    return { archetypes: {} };
  }
}

/**
 * @param {Record<string, { status: string; detail?: string }>} sections - gap record sections
 * @param {string[]} requiredSectionIds - section ids that must be complete
 * @returns {{ satisfied: boolean; incomplete: string[] }}
 */
function requiredSectionsSatisfied(sections, requiredSectionIds) {
  const incomplete = [];
  for (const id of requiredSectionIds) {
    const s = sections?.[id];
    if (!s || s.status !== "complete") incomplete.push(id);
  }
  return { satisfied: incomplete.length === 0, incomplete };
}

/**
 * Evaluate gap record against archetype. Contract = required sections complete + no issues + no next_actions.
 * @param {object} gapRecord - one entry from repo-completion-gap-rolling or repo-completion-gap-<repo>-*.json
 * @param {string} archetypeId - key from archetype-capability-packs.archetypes
 * @returns {{ satisfied: boolean; reason?: string; incomplete?: string[] }}
 */
function evaluateContract(gapRecord, archetypeId) {
  const packs = loadPacks();
  const archetype = packs.archetypes?.[archetypeId];
  if (!archetype) {
    return { satisfied: false, reason: `Unknown archetype: ${archetypeId}` };
  }

  const required = archetype.required_sections || [];
  const { satisfied: sectionsOk, incomplete } = requiredSectionsSatisfied(gapRecord.sections || {}, required);
  if (!sectionsOk) {
    return { satisfied: false, incomplete, reason: `Required sections incomplete: ${incomplete.join(", ")}` };
  }

  const issues = gapRecord.issues || [];
  if (issues.length > 0) {
    return { satisfied: false, reason: `Issues present: ${issues.length} (e.g. ${issues[0].code})` };
  }

  const nextActions = gapRecord.next_actions || [];
  if (nextActions.length > 0) {
    return { satisfied: false, reason: `Next actions present: ${nextActions.length}` };
  }

  return { satisfied: true };
}

/**
 * Get required section ids for an archetype (for gap runner / UI).
 */
function getRequiredSections(archetypeId) {
  const packs = loadPacks();
  const a = packs.archetypes?.[archetypeId];
  return a?.required_sections || [];
}

module.exports = {
  loadPacks,
  evaluateContract,
  requiredSectionsSatisfied,
  getRequiredSections,
  PACKS_PATH,
};
