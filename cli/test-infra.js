const redis = require("../infra/redis");
const pg = require("../infra/postgres");

(async () => {
  try {
    await redis.ping();
    console.log("Redis ping OK");

    const result = await pg.query("SELECT NOW()");
    console.log("Postgres time:", result.rows[0].now);

    process.exit(0);
  } catch (err) {
    console.error("Infra test failed:", err);
    process.exit(1);
  }
})();
