"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "offgrid-home");
const EVENTS_FILE = process.env.MESHTASTIC_EVENTS_FILE || path.join(DATA_DIR, "meshtastic-events.jsonl");
const COMMANDS_FILE = process.env.MESHTASTIC_COMMANDS_FILE || path.join(DATA_DIR, "meshtastic-commands.jsonl");
const HEARTBEAT_FILE = process.env.MESHTASTIC_HEARTBEAT_FILE || path.join(DATA_DIR, "meshtastic-heartbeat.json");
const PATTERN_REPORT_FILE = path.join(ROOT, "reports", "offgrid-hue-pattern-pack-latest.json");

const HA_URL = String(process.env.HOME_ASSISTANT_URL || "").replace(/\/$/, "");
const HA_TOKEN = process.env.HOME_ASSISTANT_TOKEN || "";

function ensureDirs() {
  fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(COMMANDS_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(HEARTBEAT_FILE), { recursive: true });
}

function parseCsv(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function configuredEntities() {
  return {
    lights: parseCsv(process.env.OFFGRID_LIGHT_ENTITIES),
    sensors: parseCsv(process.env.OFFGRID_SENSOR_ENTITIES),
    presence: parseCsv(process.env.OFFGRID_PRESENCE_ENTITIES),
  };
}

function appendJsonLine(filePath, row) {
  ensureDirs();
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function tailJsonLines(filePath, limit = 50) {
  try {
    const txt = fs.readFileSync(filePath, "utf8");
    const lines = txt.split("\n").filter(Boolean);
    return lines.slice(-Math.max(1, limit)).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function repoIndexPath(repoKey) {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return null;
  return path.join(home, ".code-index", `${String(repoKey).replace(/\//g, "-")}.json`);
}

function readRepoIndexMeta(repoKey) {
  const fp = repoIndexPath(repoKey);
  if (!fp) return { repo: repoKey, indexed: false };
  try {
    const stat = fs.statSync(fp);
    const payload = readJsonSafe(fp) || {};
    const symbols = Array.isArray(payload.symbols) ? payload.symbols.length : 0;
    return {
      repo: repoKey,
      indexed: true,
      path: fp,
      symbol_count: symbols,
      indexed_at: new Date(stat.mtimeMs).toISOString(),
      age_minutes: Math.round((Date.now() - stat.mtimeMs) / 60000),
    };
  } catch {
    return { repo: repoKey, indexed: false };
  }
}

async function haFetch(pathname, method = "GET", body = null) {
  if (!HA_URL || !HA_TOKEN) {
    return { ok: false, error: "home_assistant_not_configured", status: 0, data: null };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${HA_URL}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${HA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: `ha_http_${res.status}`, data };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    return { ok: false, status: 0, error: String(err.message || err), data: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function getEntityState(entityId) {
  const r = await haFetch(`/api/states/${encodeURIComponent(entityId)}`);
  if (!r.ok) return { entity_id: entityId, ok: false, error: r.error };
  return { entity_id: entityId, ok: true, state: r.data?.state, attributes: r.data?.attributes || {} };
}

async function discoverAllLights() {
  // Discover all light entities from Home Assistant
  const r = await haFetch("/api/states");
  if (!r.ok || !Array.isArray(r.data)) {
    return { ok: false, error: r.error, lights: [] };
  }
  const lights = r.data
    .filter((e) => e.entity_id && e.entity_id.startsWith("light."))
    .map((e) => {
      const features = e.attributes?.supported_features || 0;
      return {
        entity_id: e.entity_id,
        name: e.attributes?.friendly_name || e.entity_id,
        state: e.state,
        supported_features: features,
        supports_brightness: (features & 1) !== 0,
        supports_color: (features & 16) !== 0,
        brightness: e.attributes?.brightness || null,
        color_mode: e.attributes?.color_mode || null,
      };
    })
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  return { ok: true, lights, error: null };
}

async function flickerTest(entityIds, durationMs = 500, cycles = 3) {
  // Flicker test: turn on/off bulbs to identify them visually
  // Similar to Hue app's "identify" feature
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return { ok: false, error: "no_entities_provided", results: [] };
  }
  const results = [];
  const originalStates = new Map();
  
  // Save original states
  for (const entityId of entityIds) {
    const state = await getEntityState(entityId);
    if (state.ok) {
      originalStates.set(entityId, {
        on: state.state === "on",
        brightness: state.attributes?.brightness || null,
      });
    }
  }
  
  // Flicker each bulb sequentially
  for (let i = 0; i < entityIds.length; i++) {
    const entityId = entityIds[i];
    const result = { entity_id: entityId, flickered: false, error: null };
    
    try {
      // Turn on with full brightness
      await setLight(entityId, true, 100);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      
      // Turn off
      await setLight(entityId, false);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      
      // Repeat for cycles
      for (let cycle = 1; cycle < cycles; cycle++) {
        await setLight(entityId, true, 100);
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        await setLight(entityId, false);
        await new Promise((resolve) => setTimeout(resolve, durationMs));
      }
      
      result.flickered = true;
    } catch (err) {
      result.error = String(err.message || err);
    }
    
    results.push(result);
    
    // Small delay between bulbs
    if (i < entityIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  
  // Restore original states after a brief delay
  setTimeout(async () => {
    for (const [entityId, original] of originalStates.entries()) {
      try {
        if (original.on) {
          await setLight(entityId, true, original.brightness ? Math.round((original.brightness / 255) * 100) : null);
        } else {
          await setLight(entityId, false);
        }
      } catch {
        // Ignore restore errors
      }
    }
  }, 1000);
  
  return { ok: true, results, error: null };
}

async function getSnapshot() {
  const entities = configuredEntities();
  const lights = await Promise.all(entities.lights.map((e) => getEntityState(e)));
  const sensors = await Promise.all(entities.sensors.map((e) => getEntityState(e)));
  const presence = await Promise.all(entities.presence.map((e) => getEntityState(e)));
  return {
    generated_at: new Date().toISOString(),
    home_assistant_url: HA_URL || null,
    configured: {
      lights: entities.lights.length,
      sensors: entities.sensors.length,
      presence: entities.presence.length,
    },
    lights,
    sensors,
    presence,
  };
}

async function setLight(entityId, on, brightnessPct = null) {
  const service = on ? "turn_on" : "turn_off";
  const body = { entity_id: entityId };
  if (on && brightnessPct != null) {
    const b = Math.max(1, Math.min(100, Number(brightnessPct) || 100));
    body.brightness_pct = b;
  }
  return haFetch(`/api/services/light/${service}`, "POST", body);
}

async function runService(domain, service, serviceData = {}) {
  return haFetch(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, "POST", serviceData);
}

function queueMeshCommand(text, to = "broadcast", meta = {}) {
  const row = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    direction: "outbound",
    kind: "text",
    text: String(text || "").trim(),
    to,
    queued_at: new Date().toISOString(),
    ...meta,
  };
  if (!row.text) {
    throw new Error("command_text_required");
  }
  appendJsonLine(COMMANDS_FILE, row);
  return row;
}

function ingestMeshEvent(evt = {}) {
  const row = {
    id: evt.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    direction: evt.direction || "inbound",
    kind: evt.kind || "text",
    text: String(evt.text || ""),
    from: evt.from || null,
    to: evt.to || null,
    channel: evt.channel || 0,
    ts: evt.ts || new Date().toISOString(),
    raw: evt.raw || null,
  };
  appendJsonLine(EVENTS_FILE, row);
  return row;
}

function getBridgeStatus() {
  let heartbeat = null;
  try {
    heartbeat = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, "utf8"));
  } catch {
    heartbeat = null;
  }
  const events = tailJsonLines(EVENTS_FILE, 100);
  const commands = tailJsonLines(COMMANDS_FILE, 100);
  return {
    generated_at: new Date().toISOString(),
    heartbeat,
    files: {
      events: EVENTS_FILE,
      commands: COMMANDS_FILE,
      heartbeat: HEARTBEAT_FILE,
    },
    counters: {
      events_100: events.length,
      commands_100: commands.length,
      pending_commands: commands.filter((c) => !c.sent_at && !c.error).length,
    },
    recent_events: events.slice(-20),
    recent_commands: commands.slice(-20),
  };
}

function getOffgridPatternTaskTemplates() {
  return [
    {
      lane: "offgrid_lighting",
      repo: "claw-architect",
      priority: 8,
      source: "offgrid_hue_pattern_pack",
      objective:
        "Implement local-only bridge mode fallback for offgrid-home: HA direct control first, diyHue/homebridge-hue fallback hints, and stale heartbeat resilience. Add deterministic checks and report path evidence.",
    },
    {
      lane: "zigbee_reliability",
      repo: "claw-architect",
      priority: 8,
      source: "offgrid_hue_pattern_pack",
      objective:
        "Add Zigbee coordinator/rejoin reliability workflow to offgrid stack using zigbee2mqtt and zigbee-herdsman-converters best practices: detect orphan devices, schedule rejoin guidance, and surface actionable dashboard warnings.",
    },
    {
      lane: "offline_automation",
      repo: "claw-architect",
      priority: 7,
      source: "offgrid_hue_pattern_pack",
      objective:
        "Add fallback automation templates for offline operations (quiet hours, safety lights, presence-based fallback scenes) and expose quick-run controls on /offgrid-home with audit logs.",
    },
  ];
}

function getOffgridHuePatternPack() {
  const indexedRepos = [
    "home-assistant/core",
    "local/zigbee2mqtt",
    "local/zigbee-herdsman-converters",
    "local/diyHue",
    "local/esphome",
    "local/WLED",
    "local/Tasmota",
    "local/homebridge-hue",
    "local/openhab-addons",
  ].map((repo) => readRepoIndexMeta(repo));

  const latest = readJsonSafe(PATTERN_REPORT_FILE);
  return {
    generated_at: new Date().toISOString(),
    report_path: PATTERN_REPORT_FILE,
    indexed_repos: indexedRepos,
    coverage: {
      indexed_count: indexedRepos.filter((x) => x.indexed).length,
      total_count: indexedRepos.length,
    },
    tracks: [
      {
        id: "local_bridge_emulation",
        title: "Local-only bridge emulation",
        why: "Keep Philips Hue-style control during internet/Hue cloud outages.",
        best_repos: ["local/diyHue", "local/homebridge-hue", "home-assistant/core"],
        implementation_focus: [
          "Prefer HA local service control path first",
          "Expose bridge fallback health and stale-heartbeat handling",
          "Document no-cloud command path in panel",
        ],
      },
      {
        id: "zigbee_rejoin_reliability",
        title: "Zigbee coordinator/rejoin reliability",
        why: "Recover from mesh drops and sleepy-device drift quickly.",
        best_repos: ["local/zigbee2mqtt", "local/zigbee-herdsman-converters", "local/esphome"],
        implementation_focus: [
          "Detect unavailable lights and label probable rejoin-needed state",
          "Surface guided rejoin command templates",
          "Track repeated failures as reliability KPI",
        ],
      },
      {
        id: "offline_fallback_automation",
        title: "Offline fallback automation",
        why: "Keep core household automations working without WAN.",
        best_repos: ["local/WLED", "local/Tasmota", "local/openhab-addons"],
        implementation_focus: [
          "Pre-baked fallback scenes with local trigger conditions",
          "Fail-safe routines for safety lighting and presence",
          "Queue deterministic local actions with audit trail",
        ],
      },
    ],
    queue_templates: getOffgridPatternTaskTemplates(),
    latest_cached_report: latest || null,
  };
}

module.exports = {
  getSnapshot,
  getBridgeStatus,
  queueMeshCommand,
  ingestMeshEvent,
  setLight,
  runService,
  discoverAllLights,
  flickerTest,
  getOffgridHuePatternPack,
  getOffgridPatternTaskTemplates,
};
