"use strict";

async function postJson(url, body, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function evaluateOpaPolicy(taskInput) {
  const opaUrl = process.env.OPA_URL || "http://127.0.0.1:8181/v1/data/claw/policy";
  const timeoutMs = parseInt(process.env.OPA_TIMEOUT_MS || "3000", 10);
  const resp = await postJson(opaUrl, { input: taskInput }, timeoutMs);

  if (!resp.ok) {
    return {
      ok: false,
      allowed: false,
      reason: `opa_http_${resp.status}`,
      raw: resp.data,
    };
  }

  const result = resp.data?.result || {};
  const allowed = result.allowed === true;
  const denyReasons = Array.isArray(result.deny) ? result.deny : [];
  const reason = allowed ? "allowed" : (denyReasons[0] || result.reason || "opa_denied");

  return {
    ok: true,
    allowed,
    reason,
    deny: denyReasons,
    raw: result,
  };
}

module.exports = {
  evaluateOpaPolicy,
};
