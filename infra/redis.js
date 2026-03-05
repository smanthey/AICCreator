const Redis = require("ioredis");
require("dotenv").config();

const redisHost = process.env.REDIS_HOST;
const isLocalHost = redisHost === "127.0.0.1" || redisHost === "localhost";
const rawRedisPort = process.env.REDIS_PORT;
const effectivePort =
  (!isLocalHost && (!rawRedisPort || rawRedisPort === "6379"))
    ? "16379"
    : (rawRedisPort || "6379");
const redisPort = parseInt(effectivePort, 10);

const redis = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on("connect", () => {
  console.log(`✅ Redis connected (${redisHost}:${redisPort})`);
});

redis.on("error", (err) => {
  console.error(`❌ Redis error (${redisHost}:${redisPort}):`, err.message);
});

async function waitForRedisReady(timeoutMs = 10000) {
  if (redis.status === "ready") return;

  await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`Redis not ready within ${timeoutMs}ms (status=${redis.status})`));
    }, Math.max(1000, timeoutMs));

    const onReady = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };

    const onError = (err) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const cleanup = () => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("error", onError);
    };

    redis.on("ready", onReady);
    redis.on("error", onError);
  });

  await redis.ping();
}

redis.waitForRedisReady = waitForRedisReady;

module.exports = redis;
