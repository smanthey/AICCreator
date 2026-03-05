// agents/echo-agent.js
const { register } = require("./registry");

register("echo", async (payload) => {
  return {
    ok: true,
    echo: payload ?? null,
    cost_usd: 0,
    model_used: "none",
  };
});
