/**
 * Static capability anchors used by repo completion scanners.
 */
const capabilitySignals = {
  billing: ["stripe", "checkout.sessions.create", "stripe webhook signature"],
  observability: ["winston", "/health", "structured logging"],
  e2e: ["playwright", ".spec.", "end-to-end"],
  security: ["helmet", "express-rate-limit", "dependency audit"],
};

function listCapabilitySignals() {
  return Object.values(capabilitySignals).flat();
}

module.exports = { capabilitySignals, listCapabilitySignals };
