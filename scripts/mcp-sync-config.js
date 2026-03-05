#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SHARED = path.join(ROOT, "config", "mcp-servers.shared.json");
const CURSOR = path.join(ROOT, ".cursor", "mcp.json");
const VSCODE = path.join(ROOT, ".vscode", "settings.json");
const OPENCLAW = path.join(ROOT, "agent-state", "shared-context", "MCP-SERVERS-LATEST.json");
const TOOL_POLICY = path.join(ROOT, "config", "mcp-tool-policy.json");
const OAUTH_POLICY = path.join(ROOT, "config", "mcp-remote-oauth-policy.json");
const OPENCLAW_POLICY = path.join(ROOT, "agent-state", "shared-context", "MCP-TOOL-POLICY-LATEST.json");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

function toAbsoluteCommand(cmd) {
  if (!cmd) return cmd;
  if (cmd.startsWith("./")) return path.join(ROOT, cmd.slice(2));
  return cmd;
}

function discoverMcpServers(existing) {
  const servers = { ...(existing || {}) };
  const discovered = [];
  let names = [];
  try {
    names = fs.readdirSync(SCRIPTS_DIR);
  } catch {
    return { servers, discovered };
  }

  for (const name of names) {
    if (!name.endsWith(".sh")) continue;
    if (!(name === "jcodemunch-mcp.sh" || name.startsWith("mcp-"))) continue;

    const key = name === "jcodemunch-mcp.sh"
      ? "jcodemunch"
      : name.replace(/^mcp-/, "").replace(/\.sh$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
    if (!key) continue;
    if (servers[key]) continue;

    servers[key] = { command: `./scripts/${name}` };
    discovered.push(key);
  }

  return { servers, discovered };
}

function safeReadJson(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function applyPolicies(mcpServers, toolPolicy, oauthPolicy) {
  const toolList = Array.isArray(toolPolicy?.tools) ? toolPolicy.tools : [];
  const byId = new Map(toolList.map((x) => [String(x.id || "").toLowerCase(), x]));
  const defaultPolicy = toolPolicy?.defaults || {};

  const mapped = Object.fromEntries(
    Object.entries(mcpServers).map(([name, cfg]) => {
      const keyPrefix = String(name || "").toLowerCase();
      const toolHints = toolList.filter((t) => String(t.id || "").toLowerCase().startsWith(`${keyPrefix}.`));
      const genericRead = byId.get(`${keyPrefix}.read`) || null;
      const genericWrite = byId.get(`${keyPrefix}.write`) || null;

      return [
        name,
        {
          ...cfg,
          x_policy: {
            strategy: defaultPolicy.strategy || "resources_first_tools_second",
            use_when: genericRead?.use_when || `Use ${name} when authoritative ${name} context is needed.`,
            do_not_use_when: genericRead?.do_not_use_when || `Do not use ${name} when another source is already sufficient.`,
            require_confirmation_on_write:
              genericWrite?.requires_confirmation ??
              Boolean(defaultPolicy.require_confirmation_on_write),
            tools: toolHints.map((t) => ({
              id: t.id,
              class: t.class,
              use_when: t.use_when,
              do_not_use_when: t.do_not_use_when,
              requires_confirmation: t.requires_confirmation,
            })),
          },
          x_remote_oauth: oauthPolicy?.remote_mcp || null,
        },
      ];
    })
  );

  return mapped;
}

/** Normalize server config so Cursor can start it: use bash + args + cwd for script-based servers. */
function cursorReadyServers(servers) {
  const result = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (name === "index-everything") continue; // not an MCP server, skip
    const cmd = cfg.command || "";
    if (cmd.startsWith("./scripts/") || cmd === "bash") {
      const script = cmd.startsWith("./scripts/") ? cmd : (cfg.args && cfg.args[0]) || "";
      result[name] = {
        ...cfg,
        command: "bash",
        args: script ? [script] : (cfg.args || []),
        cwd: cfg.cwd || ROOT,
      };
    } else if (cmd === "npx" && Array.isArray(cfg.args) && cfg.args[0] && cfg.args[0].includes("trigger.dev")) {
      result[name] = { ...cfg, command: "bash", args: ["./scripts/mcp-trigger.sh"], cwd: ROOT };
    } else {
      result[name] = { ...cfg, cwd: cfg.cwd || ROOT };
    }
  }
  return result;
}

function main() {
  const shared = readJson(SHARED);
  const toolPolicy = safeReadJson(TOOL_POLICY);
  const oauthPolicy = safeReadJson(OAUTH_POLICY);
  const autoDiscover = String(process.env.MCP_SYNC_AUTO_DISCOVER || "1") !== "0";
  const baseServers = shared.mcpServers || {};
  const discovery = autoDiscover ? discoverMcpServers(baseServers) : { servers: baseServers, discovered: [] };
  let mcpServers = applyPolicies(discovery.servers, toolPolicy, oauthPolicy);
  delete mcpServers["index-everything"];
  const cursorServers = cursorReadyServers(mcpServers);

  if (autoDiscover && discovery.discovered.length) {
    writeJson(SHARED, { mcpServers });
  }

  writeJson(CURSOR, { mcpServers: cursorServers });
  writeJson(VSCODE, { "mcp.servers": mcpServers });

  const openclawServers = Object.fromEntries(
    Object.entries(mcpServers).map(([key, cfg]) => [
      key,
      {
        command: toAbsoluteCommand(cfg.command || (cfg.args && cfg.args[0]) || ""),
        args: Array.isArray(cfg.args) ? cfg.args : [],
      },
    ])
  );
  writeJson(OPENCLAW, {
    generated_at: new Date().toISOString(),
    source: SHARED,
    mcpServers: openclawServers,
  });
  writeJson(OPENCLAW_POLICY, {
    generated_at: new Date().toISOString(),
    source: {
      tool_policy: TOOL_POLICY,
      oauth_policy: OAUTH_POLICY,
    },
    defaults: toolPolicy?.defaults || {},
    tools: Array.isArray(toolPolicy?.tools) ? toolPolicy.tools : [],
    remote_mcp: oauthPolicy?.remote_mcp || {},
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        synced: {
          shared: SHARED,
          cursor: CURSOR,
          vscode: VSCODE,
          openclaw: OPENCLAW,
          policy: OPENCLAW_POLICY,
        },
        auto_discover: autoDiscover,
        discovered_servers: discovery.discovered,
        servers: Object.keys(mcpServers),
      },
      null,
      2
    )
  );
}

main();
