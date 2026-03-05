const { dispatchPendingTasks, startWorker, reapStuckTasks } = require("../control/dispatcher");
const { setupPgNotifyListener } = require("../control/pg-notify");
const redis = require("../infra/redis");

(async () => {
  const redisStartupTimeoutMs = parseInt(process.env.REDIS_STARTUP_TIMEOUT_MS || "10000", 10);
  await redis.waitForRedisReady(redisStartupTimeoutMs);

  const embeddedWorker = ["1", "true", "yes", "on"].includes(
    String(process.env.DISPATCHER_EMBEDDED_WORKER || "").toLowerCase()
  );
  if (embeddedWorker) {
    await startWorker();
    console.log("Dispatcher embedded worker enabled.");
  } else {
    console.log("Dispatcher running in dispatch-only mode (no embedded worker).");
  }

  console.log("Dispatcher running...");

  // IMPORTANT: run once immediately (no waiting for setInterval)
  await dispatchPendingTasks();

  // pg_notify: wake immediately when plans inserted (e.g. from architect API)
  const listenClient = await setupPgNotifyListener(dispatchPendingTasks);

  // Keep polling as fallback — 5s when LISTEN active, 3s otherwise
  const pollInterval = listenClient ? 5000 : 3000;
  setInterval(async () => {
    await dispatchPendingTasks();
  }, pollInterval);

  // Reap timed-out/lost tasks periodically.
  setInterval(async () => {
    await reapStuckTasks();
  }, 15000);
})();
