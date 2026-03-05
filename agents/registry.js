// agents/registry.js
const handlers = new Map();

function register(type, fn) {
  if (!type) throw new Error("register() requires a task type");
  if (typeof fn !== "function") throw new Error(`register(${type}) requires a function`);
  handlers.set(type, fn);
}

function getHandler(type) {
  const fn = handlers.get(type);
  if (!fn) return null; // dispatcher will throw a clear error if null
  return fn;
}

function getRegisteredTypes() {
  return [...handlers.keys()];
}

module.exports = { register, getHandler, getRegisteredTypes };
