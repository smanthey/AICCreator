#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const { loadConfiguredAppMeta, annotatePm2Process } = require("../control/pm2-runtime-classifier");

function parsePm2() {
  const raw = execSync("pm2 jlist", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const list = JSON.parse(raw || "[]");
  return Array.isArray(list) ? list : [];
}

function main() {
  const pm2 = parsePm2();
  const byName = loadConfiguredAppMeta();
  const rows = pm2
    .map((proc) => {
      const meta = annotatePm2Process(proc, byName);
      return {
        name: String(proc.name || ""),
        status: String(proc.pm2_env?.status || "unknown"),
        runtime_class: meta.runtime_class,
        cron: meta.cron_restart || "",
        restarts: Number(proc.pm2_env?.restart_time || 0),
      };
    })
    .filter((r) => r.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = rows.reduce(
    (acc, row) => {
      if (!acc[row.runtime_class]) acc[row.runtime_class] = { total: 0, online: 0, stopped: 0, errored: 0 };
      acc[row.runtime_class].total += 1;
      if (row.status === "online") acc[row.runtime_class].online += 1;
      if (row.status === "stopped") acc[row.runtime_class].stopped += 1;
      if (row.status === "errored") acc[row.runtime_class].errored += 1;
      return acc;
    },
    {}
  );

  console.log("PM2 Runtime Classes");
  console.table(
    Object.entries(counts).map(([runtime_class, c]) => ({
      runtime_class,
      total: c.total,
      online: c.online,
      stopped: c.stopped,
      errored: c.errored,
    }))
  );

  console.log("PM2 Processes");
  console.table(rows);
}

main();

