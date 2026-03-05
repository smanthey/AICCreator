#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const files = [];
const skip = new Set([".git","node_modules",".next","dist","build"]);
const stack = [root];
while (stack.length) {
  const dir = stack.pop();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.has(e.name)) stack.push(full); continue; }
    if (!e.isFile()) continue;
    if (/.(ts|tsx|js|jsx|sql)$/.test(e.name)) files.push(full);
  }
}

let hasBetterAuth = false;
let authSignals = false;
let hasOrgModel = false;
let hasRbac = false;
for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  if (/better-auth/.test(txt)) hasBetterAuth = true;
  if (/next-auth|supabase|firebase|clerk|getServerSession|auth(/.test(txt)) authSignals = true;
  if (/organization_id|org_id|tenant_id/.test(txt)) hasOrgModel = true;
  if (/requireRole|hasRole|rbac|roles*[:=]/.test(txt)) hasRbac = true;
}

const errs = [];
if (authSignals && !hasBetterAuth) errs.push("better-auth baseline missing");
if (!hasOrgModel) errs.push("multi-tenant org model signal missing");
if (!hasRbac) errs.push("rbac signal missing");
if (errs.length) {
  console.error("baseline gate failed:");
  for (const e of errs) console.error("- " + e);
  process.exit(1);
}
console.log("baseline gate pass");
