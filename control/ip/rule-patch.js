"use strict";

function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return deepClone(override);
  const out = deepClone(base);
  for (const [k, v] of Object.entries(override)) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = deepClone(v);
  }
  return out;
}

function decodeToken(token) {
  return String(token).replace(/~1/g, "/").replace(/~0/g, "~");
}

function parsePath(pointer) {
  if (pointer === "" || pointer === "/") return [];
  if (!String(pointer).startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return String(pointer).split("/").slice(1).map(decodeToken);
}

function getContainer(root, tokens) {
  let cur = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const t = tokens[i];
    if (Array.isArray(cur)) {
      const idx = t === "-" ? cur.length : Number(t);
      if (!Number.isInteger(idx) || idx < 0) throw new Error(`Invalid array index: ${t}`);
      if (cur[idx] == null) cur[idx] = {};
      cur = cur[idx];
    } else {
      if (!isObject(cur[t])) cur[t] = {};
      cur = cur[t];
    }
  }
  const key = tokens[tokens.length - 1];
  return { container: cur, key };
}

function applyOp(target, op) {
  const operation = String(op.op || "").toLowerCase();
  const tokens = parsePath(op.path);

  if (!tokens.length && operation !== "replace") {
    throw new Error(`Unsupported root operation: ${operation}`);
  }

  if (!tokens.length && operation === "replace") {
    return deepClone(op.value);
  }

  const { container, key } = getContainer(target, tokens);

  if (Array.isArray(container)) {
    const idx = key === "-" ? container.length : Number(key);
    if (!Number.isInteger(idx) || idx < 0) throw new Error(`Invalid array index: ${key}`);

    if (operation === "add") {
      if (key === "-") container.push(deepClone(op.value));
      else container.splice(idx, 0, deepClone(op.value));
      return target;
    }
    if (operation === "replace") {
      container[idx] = deepClone(op.value);
      return target;
    }
    if (operation === "remove") {
      container.splice(idx, 1);
      return target;
    }
    throw new Error(`Unsupported op for array: ${operation}`);
  }

  if (operation === "add" || operation === "replace") {
    container[key] = deepClone(op.value);
    return target;
  }
  if (operation === "remove") {
    delete container[key];
    return target;
  }
  throw new Error(`Unsupported op: ${operation}`);
}

function applyJsonPatch(baseObj, patchOps) {
  const out = deepClone(baseObj);
  const ops = Array.isArray(patchOps) ? patchOps : [];
  for (const op of ops) {
    applyOp(out, op);
  }
  return out;
}

function normalizeExaminerName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

module.exports = {
  deepClone,
  deepMerge,
  applyJsonPatch,
  normalizeExaminerName,
};
