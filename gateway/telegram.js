// gateway/telegram.js
// ClawdBot Telegram operator interface — built on Telegraf 4.x.
//
// Enterprise additions:
//  - Telegraf (no polling memory leak from node-telegram-bot-api)
//  - Inline keyboard buttons for APPROVE / REJECT / CONFIRM
//  - Per-user Redis rate limiting (10 msg/min sliding window)
//  - Budget pre-flight check before planning
//  - Vague goal detection via verifier.js
//  - pg_notify LISTEN replaces 1s dispatch polling (sub-100ms task start)
//  - bot.catch() global error boundary with Telegram notification
//  - Tier 3 alert:true modal for irreversible confirmations
//  - editMessageReplyMarkup to disable buttons after tap (prevents double-submit)
//  - Graceful shutdown via bot.stop()
//  - notifier.js wired in for dead-letter + budget alerts
//  - Startup env validation via infra/config.js

"use strict";

require("dotenv").config();
const { validateConfig } = require("../infra/config");
validateConfig(); // FAIL FAST — crash immediately if env is misconfigured

const crypto     = require("crypto");
const { Telegraf, Markup } = require("telegraf");

const planner    = require("../agents/planner");
const { verifyPlan } = require("../agents/verifier");
const { insertPlan } = require("../control/inserter");
const { startWorker,
        dispatchPendingTasks,
        recoverStuckTasks,
        reapStuckTasks }        = require("../control/dispatcher");
const { snapshot }              = require("../control/metrics");
const { triggerEmergencyStop,
        clearEmergencyStop,
        isEmergencyStopped,
        stopPlan }              = require("../control/emergency");
const { checkBudget,
        spendSummary }          = require("../control/budget");
const notifier                  = require("../control/notifier");
const pg                        = require("../infra/postgres");
const redis                     = require("../infra/redis");

// ─────────────────────────────────────────────────────────────
// BOT SETUP
// ─────────────────────────────────────────────────────────────

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Wire notifier so dead-letter + budget alerts can push to operators
notifier.setBot(bot);

// ── Global error boundary ─────────────────────────────────────
// Catches any unhandled error thrown from middleware or handlers.
// Logs structured context + sends user-friendly reply + alerts operator.
bot.catch(async (err, ctx) => {
  const context = {
    userId:    ctx.from?.id,
    username:  ctx.from?.username,
    chatId:    ctx.chat?.id,
    text:      ctx.message?.text?.slice(0, 100),
    error:     err.message,
    stack:     err.stack?.split("\n").slice(0, 3).join(" | "),
    ts:        new Date().toISOString(),
  };
  console.error("[telegram] Unhandled error:", JSON.stringify(context));

  // User-facing reply — never expose raw error messages
  try { await ctx.reply("❌ Something went wrong. Try again or type `help`.", { parse_mode: "Markdown" }); } catch (_) {}

  // Alert operator via notifier
  notifier.broadcast(
    `🔥 *Unhandled bot error*\nUser: \`${context.userId}\` (@${escMd(context.username || "unknown")})\n` +
    `Text: _${escMd(context.text || "(none)")}_\n` +
    `Error: \`${escMd(err.message.slice(0, 120))}\``
  ).catch(() => {});
});

console.log("[telegram] Telegraf bot initialised");

// ─────────────────────────────────────────────────────────────
// RATE LIMITING (10 messages/min per user, stored in Redis)
// ─────────────────────────────────────────────────────────────

const RATE_LIMIT   = 10;
const RATE_WINDOW  = 60; // seconds

async function checkRateLimit(userId) {
  const key   = `clawbot:rl:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_WINDOW);
  return count <= RATE_LIMIT;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const TELEGRAM_MAX = 4000;

/** Escape Markdown v1 special chars in user-supplied strings. */
function escMd(text) {
  return String(text ?? "").replace(/([_*`\[])/g, "\\$1");
}

async function reply(ctx, text, extra = {}) {
  const safe = text.length > TELEGRAM_MAX
    ? text.slice(0, TELEGRAM_MAX - 30) + "\n…_(truncated)_"
    : text;
  try {
    return await ctx.reply(safe, { parse_mode: "Markdown", ...extra });
  } catch (err) {
    console.warn("[telegram] Markdown send failed, retrying plain:", err.message);
    return ctx.reply(safe.replace(/[_*`\[\]]/g, ""), extra);
  }
}

async function replyDirect(chatId, text, extra = {}) {
  const safe = text.length > TELEGRAM_MAX
    ? text.slice(0, TELEGRAM_MAX - 30) + "\n…_(truncated)_"
    : text;
  try {
    return await bot.telegram.sendMessage(chatId, safe, { parse_mode: "Markdown", ...extra });
  } catch (err) {
    console.warn("[telegram] Direct Markdown send failed:", err.message);
    return bot.telegram.sendMessage(chatId, safe.replace(/[_*`\[\]]/g, ""), extra);
  }
}

// ─────────────────────────────────────────────────────────────
// AUTHORIZATION
// ─────────────────────────────────────────────────────────────

async function getRole(userId) {
  const { rows } = await pg.query(
    `SELECT role FROM telegram_users WHERE telegram_user_id = $1`,
    [String(userId)]
  );
  return rows.length > 0 ? rows[0].role : null;
}

// ─────────────────────────────────────────────────────────────
// TIER LABELS
// ─────────────────────────────────────────────────────────────

const TIER_LABEL = {
  0: "🟢 Tier 0 — Auto",
  1: "🔵 Tier 1 — Soft confirm",
  2: "🟡 Tier 2 — Approval required",
  3: "🔴 Tier 3 — Two-step required",
};

const RISK_ICON = { low: "🟢", med: "🟡", high: "🔴" };

// ─────────────────────────────────────────────────────────────
// AUTH + RATE LIMIT MIDDLEWARE
// ─────────────────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  const text   = ctx.message?.text?.trim();

  // /start is always allowed — needed to get user ID
  if (text === "/start" || text?.toLowerCase() === "start") return next();

  // Rate limit check
  if (userId) {
    const allowed = await checkRateLimit(userId);
    if (!allowed) {
      return ctx.reply(`⏳ Too many requests. Please wait a moment.`);
    }
  }

  return next();
});

// ─────────────────────────────────────────────────────────────
// COMMAND HANDLERS
// ─────────────────────────────────────────────────────────────

async function handleStart(ctx) {
  const userId = ctx.from?.id;
  const role   = await getRole(userId);
  if (role) {
    return reply(ctx, `👋 Welcome back to *ClawdBot*.\n\nType \`help\` to see commands.`);
  }
  return reply(ctx, `👋 *ClawdBot*\n\nNot authorised.\nYour ID: \`${userId}\``);
}

async function handleHelp(ctx) {
  return reply(ctx, [
    "*ClawdBot — Commands*",
    "",
    "*Plans*",
    "`status <plan-id>` — task statuses",
    "`plans` — last 10 plans",
    "`stop <plan-id>` — cancel a plan immediately",
    "",
    "*Emergency*",
    "`/estop` — 🛑 EMERGENCY STOP — halts all execution immediately",
    "`/resume` — resume after emergency stop",
    "",
    "*Monitoring*",
    "`workers` — live worker heartbeat pool",
    "`metrics` — queue depth, cost, performance",
    "`deadletters` — recently failed tasks",
    "`budget` — today's spend vs cap",
    "",
    "*Approval (or tap buttons in the plan message)*",
    "`APPROVE <token>` — approve a Tier 2 plan",
    "`REJECT <token>` — reject a plan",
    "`CONFIRM <token>` — second confirm for Tier 3 plans",
    "",
    "_Anything else is treated as a goal and sent to the planner._"
  ].join("\n"));
}

async function handleStop(ctx, planId) {
  if (!planId) {
    return reply(ctx, "Usage: `stop <plan-id>`\n\nType `plans` to list recent IDs.");
  }

  const { rows } = await pg.query(
    `SELECT id, goal, status FROM plans WHERE id::text LIKE $1 ORDER BY created_at DESC LIMIT 1`,
    [`${planId}%`]
  );

  const plan = rows[0];
  if (!plan) return reply(ctx, `❌ No plan found matching \`${escMd(planId)}\``);

  if (["cancelled", "completed", "failed"].includes(plan.status)) {
    return reply(ctx, `Plan \`${plan.id.slice(0, 8)}\` is already *${plan.status}* — nothing to stop.`);
  }

  const cancelled = await stopPlan(plan.id);
  console.log(`[telegram] ✋ Plan ${plan.id} stopped by ${ctx.from?.id}`);

  return reply(ctx,
    `✋ *Plan stopped*\n` +
    `\`${plan.id.slice(0, 8)}\` — _${escMd(plan.goal.slice(0, 60))}_\n` +
    `${cancelled} tasks cancelled.`
  );
}

async function handleEmergencyStop(ctx) {
  const existing = await isEmergencyStopped();
  if (existing) {
    return reply(ctx,
      `🛑 *Already in emergency stop*\nTriggered at ${existing.triggered_at}\n\nType \`/resume\` to resume.`
    );
  }

  const cancelled = await triggerEmergencyStop(ctx.from?.id);
  await notifier.notifyEmergencyStop(ctx.from?.id);
  return reply(ctx,
    `🛑 *EMERGENCY STOP ACTIVE*\n\n` +
    `All queues paused. ${cancelled} in-flight tasks reset.\n\n` +
    `Type \`/resume\` when ready to restart.`
  );
}

async function handleResume(ctx) {
  const existing = await isEmergencyStopped();
  if (!existing) {
    return reply(ctx, "✅ System is not in emergency stop. Already running normally.");
  }

  await clearEmergencyStop(ctx.from?.id);
  return reply(ctx, `✅ *Emergency stop cleared*\n\nQueues resumed. Workers will pick up tasks within 10 seconds.`);
}

async function handleStatus(ctx, planId) {
  if (!planId) return reply(ctx, "Usage: `status <plan-id>`\n\nType `plans` to list recent plan IDs.");

  let { rows } = await pg.query(
    `SELECT type, title, status, retry_count, last_error FROM tasks WHERE plan_id = $1 ORDER BY sequence`,
    [planId]
  );

  if (!rows.length) {
    const { rows: pRows } = await pg.query(
      `SELECT t.type, t.title, t.status, t.retry_count, t.last_error, t.plan_id
       FROM tasks t WHERE t.plan_id::text LIKE $1 ORDER BY t.sequence LIMIT 30`,
      [`${planId}%`]
    );
    if (pRows.length) { planId = pRows[0].plan_id; rows = pRows; }
  }

  if (!rows.length) return reply(ctx, `❌ No plan found: \`${escMd(planId)}\``);

  const { rows: planRows } = await pg.query(
    `SELECT goal, status AS plan_status, intent_tier FROM plans WHERE id = $1`, [planId]
  );

  const icons = { COMPLETED:"✓", DEAD_LETTER:"☠", SKIPPED:"⊘", CANCELLED:"✕", RUNNING:"▶", CREATED:"○", PENDING:"…", RETRY:"↻" };
  const lines = rows.map(r => {
    const icon = icons[r.status] || "?";
    const err  = r.last_error ? ` _(${escMd(r.last_error.slice(0, 50))})_` : "";
    const ret  = r.retry_count > 0 ? ` ×${r.retry_count}` : "";
    return `${icon} \`${r.type}\` — ${r.status}${ret}${err}`;
  });

  const header = planRows.length
    ? `*Plan* \`${planId.slice(0, 8)}\` [${planRows[0].plan_status}]\n_${escMd(planRows[0].goal.slice(0, 80))}_\n`
    : `*Plan* \`${planId.slice(0, 8)}\`\n`;

  return reply(ctx, `${header}\n${lines.join("\n")}`);
}

async function handlePlans(ctx) {
  const { rows } = await pg.query(
    `SELECT id, goal, status, total_tasks, completed_tasks, actual_cost_usd, created_at, intent_tier
     FROM plans ORDER BY created_at DESC LIMIT 10`
  );

  if (!rows.length) return reply(ctx, "No plans yet.");

  const tierIcon = { 0:"🟢", 1:"🔵", 2:"🟡", 3:"🔴" };
  const lines = rows.map(r => {
    const age  = Math.round((Date.now() - new Date(r.created_at)) / 60000);
    const cost = r.actual_cost_usd ? ` $${Number(r.actual_cost_usd).toFixed(3)}` : "";
    const tier = tierIcon[r.intent_tier] || "⚪";
    return `${tier} \`${r.id.slice(0, 8)}\` [${r.status}] ${r.completed_tasks}/${r.total_tasks}${cost} — _${escMd(r.goal.slice(0, 45))}_ (${age}m)`;
  });

  return reply(ctx, `*Recent Plans* (last 10)\n\n${lines.join("\n")}`);
}

async function handleWorkers(ctx) {
  const { rows } = await pg.query(
    `SELECT worker_id, hostname, tags, node_role, last_seen, started_at,
            tasks_completed, tasks_failed, load_avg, free_ram_mb
     FROM workers ORDER BY last_seen DESC`
  );

  const emergencyState = await isEmergencyStopped();
  if (!rows.length) return reply(ctx, "🤖 No workers registered yet.");

  const now = Date.now();
  const lines = rows.map(w => {
    const secsAgo = Math.round((now - new Date(w.last_seen)) / 1000);
    const alive   = secsAgo < 30;
    const icon    = alive ? "🟢" : secsAgo < 120 ? "🟡" : "🔴";
    const load    = w.load_avg   != null ? ` load=${w.load_avg}` : "";
    const ram     = w.free_ram_mb != null ? ` ram=${w.free_ram_mb}MB` : "";
    const uptime  = w.started_at ? Math.round((now - new Date(w.started_at)) / 60000) + "m" : "?";
    return (
      `${icon} \`${escMd(w.hostname || w.worker_id)}\` [${escMd(w.node_role)}]\n` +
      `   tags: ${escMd((w.tags||[]).join(", ")||"none")} | up: ${uptime}${load}${ram}\n` +
      `   ✓ ${w.tasks_completed} done | ✗ ${w.tasks_failed} failed | seen: ${secsAgo}s ago`
    );
  });

  const aliveCount      = rows.filter(w => (now - new Date(w.last_seen)) / 1000 < 30).length;
  const emergencyBanner = emergencyState
    ? `\n\n🛑 *EMERGENCY STOP ACTIVE* since ${emergencyState.triggered_at}`
    : "";

  return reply(ctx, `*Worker Pool* — ${aliveCount}/${rows.length} alive${emergencyBanner}\n\n${lines.join("\n\n")}`);
}

async function handleDeadLetters(ctx) {
  const { rows } = await pg.query(
    `SELECT t.type, t.last_error, t.dead_lettered_at, t.retry_count, p.goal
     FROM tasks t LEFT JOIN plans p ON p.id = t.plan_id
     WHERE t.status = 'DEAD_LETTER'
     ORDER BY t.dead_lettered_at DESC LIMIT 10`
  );

  if (!rows.length) return reply(ctx, "🎉 No dead-lettered tasks.");

  const lines = rows.map(r => {
    const when = r.dead_lettered_at
      ? Math.round((Date.now() - new Date(r.dead_lettered_at)) / 60000) + "m ago"
      : "unknown";
    return `☠ \`${r.type}\` — _${escMd((r.last_error||"unknown").slice(0, 80))}_ (${when}, ×${r.retry_count})`;
  });

  return reply(ctx, `*Dead Letters* (last 10)\n\n${lines.join("\n")}`);
}

async function handleMetrics(ctx) {
  try {
    const s = await snapshot();
    const emergencyState = await isEmergencyStopped();
    const emergencyLine  = emergencyState ? "\n🛑 *EMERGENCY STOP ACTIVE*" : "";
    return reply(ctx, [
      "*ClawdBot Metrics*" + emergencyLine, "",
      `*Queue:* ${s.queue.running} running | ${s.queue.queued} queued | ${s.queue.retrying} retrying`,
      `*Last 24h:* ${s.last24h.completed} done | ${s.last24h.dead_letters} dead | ${s.last24h.dead_letter_rate_pct}% DL rate`,
      `*Performance:* avg ${s.performance.avg_duration_ms}ms | max ${s.performance.max_duration_ms}ms`,
      `*Cost:* $${s.cost.last_24h_usd} today | $${s.cost.total_usd} total`
    ].join("\n"));
  } catch (err) {
    return reply(ctx, `❌ Metrics error: ${escMd(err.message)}`);
  }
}

async function handleBudget(ctx) {
  try {
    const summary = await spendSummary();
    const pct     = ((summary.spent_usd / summary.daily_cap_usd) * 100).toFixed(1);
    const bar     = buildBar(summary.spent_usd, summary.daily_cap_usd, 10);
    return reply(ctx, [
      `*Budget — Today*`,
      ``,
      `${bar} ${pct}%`,
      `Spent: $${summary.spent_usd.toFixed(4)}`,
      `Cap:   $${summary.daily_cap_usd.toFixed(2)}`,
      `Left:  $${summary.remaining_usd.toFixed(4)}`,
    ].join("\n"));
  } catch (err) {
    return reply(ctx, `❌ Budget error: ${escMd(err.message)}`);
  }
}

function buildBar(spent, cap, width) {
  const filled = Math.min(Math.round((spent / cap) * width), width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

// ─────────────────────────────────────────────────────────────
// APPROVAL HANDLERS (token-based + inline button-based)
// ─────────────────────────────────────────────────────────────

async function handleApprove(ctx, token) {
  const userId = ctx.from?.id;
  const { rows } = await pg.query(
    `UPDATE plan_approvals
     SET approved = true, approved_at = NOW()
     WHERE approval_token = $1 AND approved = false AND expires_at > NOW()
     RETURNING plan_id`,
    [token]
  );

  if (!rows.length) return reply(ctx, "❌ Token invalid, already used, or expired.");

  const planId = rows[0].plan_id;
  const { rows: planRows } = await pg.query(`SELECT intent_tier FROM plans WHERE id = $1`, [planId]);
  const tier = planRows[0]?.intent_tier ?? 2;

  if (tier === 3) {
    const confirmToken = crypto.randomBytes(3).toString("hex").toUpperCase();
    await pg.query(`UPDATE plan_approvals SET confirm_token = $1 WHERE plan_id = $2`, [confirmToken, planId]);
    return reply(ctx,
      `⚠️ *Tier 3 — Second confirmation required*\n\n` +
      `Reply: \`CONFIRM ${confirmToken}\`\n_Expires in 10 minutes._`,
      Markup.inlineKeyboard([
        Markup.button.callback(`✅ CONFIRM ${confirmToken}`, `CONFIRM:${confirmToken}`),
        Markup.button.callback("❌ Cancel", `REJECT:${token}`),
      ])
    );
  }

  await pg.query(
    `UPDATE tasks SET status = 'CREATED'
     WHERE plan_id = $1 AND status = 'PENDING' AND approval_required = true
       AND (depends_on IS NULL OR depends_on = '{}')`,
    [planId]
  );

  console.log(`[telegram] ✅ Plan ${planId} approved (tier ${tier}) by ${userId}`);
  return reply(ctx, `✅ *Plan approved* — root tasks dispatching now.\n\`${planId.slice(0, 8)}\``);
}

async function handleReject(ctx, token) {
  const { rows } = await pg.query(
    `SELECT plan_id FROM plan_approvals WHERE approval_token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (!rows.length) return reply(ctx, "❌ Token invalid or expired.");

  const planId = rows[0].plan_id;
  await pg.query(`UPDATE plans SET status = 'cancelled' WHERE id = $1`, [planId]);
  await pg.query(`UPDATE tasks SET status = 'CANCELLED' WHERE plan_id = $1 AND status = 'PENDING'`, [planId]);
  console.log(`[telegram] ✕ Plan ${planId} rejected by ${ctx.from?.id}`);
  return reply(ctx, `✕ *Plan rejected and cancelled.*\n\`${planId.slice(0, 8)}\``);
}

async function handleConfirm(ctx, token) {
  const { rows } = await pg.query(
    `SELECT plan_id FROM plan_approvals WHERE confirm_token = $1 AND approved = true AND expires_at > NOW()`,
    [token]
  );

  if (!rows.length) return reply(ctx, "❌ Confirm token invalid or expired.");

  const planId = rows[0].plan_id;
  await pg.query(
    `UPDATE tasks SET status = 'CREATED'
     WHERE plan_id = $1 AND status = 'PENDING' AND approval_required = true
       AND (depends_on IS NULL OR depends_on = '{}')`,
    [planId]
  );
  await pg.query(`UPDATE plan_approvals SET confirm_token = NULL WHERE plan_id = $1`, [planId]);

  console.log(`[telegram] ✅ Plan ${planId} CONFIRMED (Tier 3) by ${ctx.from?.id}`);
  return reply(ctx, `✅ *Confirmed* — Tier 3 plan executing.\n\`${planId.slice(0, 8)}\``);
}

// ─────────────────────────────────────────────────────────────
// INLINE BUTTON CALLBACKS
// ─────────────────────────────────────────────────────────────

bot.on("callback_query", async (ctx) => {
  const data   = ctx.callbackQuery?.data || "";
  const userId = ctx.from?.id;

  const role = await getRole(userId);
  if (!role) {
    await ctx.answerCbQuery("⛔ Not authorised.");
    return;
  }

  // Rate limit also applies to button taps
  const allowed = await checkRateLimit(userId);
  if (!allowed) {
    await ctx.answerCbQuery("⏳ Too many requests.");
    return;
  }

  if (data.startsWith("APPROVE:")) {
    // Acknowledge with a toast — acknowledging removes the "loading" spinner
    await ctx.answerCbQuery("Processing approval…");
    // Disable the buttons immediately to prevent double-tap race condition
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    return handleApprove(ctx, data.slice(8)).catch(console.error);
  }

  if (data.startsWith("REJECT:")) {
    await ctx.answerCbQuery("Rejecting plan…");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    return handleReject(ctx, data.slice(7)).catch(console.error);
  }

  if (data.startsWith("CONFIRM:")) {
    // Tier 3 CONFIRM: show a blocking alert modal (requires user dismiss)
    // This is the last safety gate before irreversible actions execute.
    await ctx.answerCbQuery(
      "⚠️ FINAL CONFIRMATION — This will execute irreversible actions. " +
      "Tap OK only if you are certain.",
      { show_alert: true }
    );
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    return handleConfirm(ctx, data.slice(8)).catch(console.error);
  }

  // Unknown callback — acknowledge to clear loading state
  await ctx.answerCbQuery();
});

// ─────────────────────────────────────────────────────────────
// GOAL → PLANNER
// ─────────────────────────────────────────────────────────────

async function handleGoal(ctx, text) {
  await reply(ctx, "🧠 Planning...");

  // Budget pre-flight: block if daily cap already exceeded
  try {
    const summary = await spendSummary();
    if (summary.remaining_usd <= 0) {
      await notifier.notifyBudgetExhausted(summary);
      return reply(ctx,
        `🚫 *Daily budget cap hit* — cannot start new plan.\n` +
        `Spent $${summary.spent_usd.toFixed(3)} of $${summary.daily_cap_usd} today.\n` +
        `Raise \`DAILY_COST_CAP_USD\` in .env or wait until tomorrow.`
      );
    }
  } catch (budgetErr) {
    console.warn("[telegram] Budget check failed:", budgetErr.message);
    // Non-fatal: proceed if budget check itself errors
  }

  const typingInterval = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);

  try {
    const taskPlan = await planner.plan(text);

    // Budget check against plan estimate
    try {
      await checkBudget(taskPlan.estimated_cost_usd || 0);
    } catch (budgetErr) {
      clearInterval(typingInterval);
      return reply(ctx, `💸 *Budget cap would be exceeded*\n\n${escMd(budgetErr.message)}`);
    }

    // Plan verifier check
    let verifyWarnings = [];
    let goalRefinement = null;
    try {
      const vResult = await verifyPlan(taskPlan);
      verifyWarnings = vResult.warnings || [];
      goalRefinement = vResult.goal_refinement;
    } catch (verifyErr) {
      clearInterval(typingInterval);
      return reply(ctx,
        `🚫 *Plan blocked by verifier*\n\n${escMd(verifyErr.message)}\n\n` +
        `Please refine your goal and try again.`
      );
    }

    clearInterval(typingInterval);

    const { planId } = await insertPlan(taskPlan);

    const tier       = taskPlan.intent_tier ?? 2;
    const tierLabel  = TIER_LABEL[tier] || "Tier 2";
    const riskIcon   = RISK_ICON[taskPlan.risk_level] || "⚪";
    const categories = (taskPlan.intent_categories || []).join(", ") || "none";
    const resources  = taskPlan.resource_estimates || {};
    const machines   = (taskPlan.machines_involved || []).join(", ") || "unknown";

    // Build task breakdown (max 10 shown)
    const taskLines = taskPlan.tasks.slice(0, 10).map((t, i) =>
      `${i + 1}. \`${t.type}\` — ${escMd(t.title)}`
    );
    if (taskPlan.tasks.length > 10) taskLines.push(`_…and ${taskPlan.tasks.length - 10} more_`);

    // Resource summary
    const resourceLines = [];
    if (resources.api_calls)          resourceLines.push(`API: ~${resources.api_calls}`);
    if (resources.emails_sent)        resourceLines.push(`Emails: ~${resources.emails_sent}`);
    if (resources.db_rows_written)    resourceLines.push(`DB: ~${resources.db_rows_written} rows`);
    if (resources.llm_tokens_estimate)resourceLines.push(`LLM: ~${resources.llm_tokens_estimate} tokens`);

    // Verifier warnings
    const warnLine = verifyWarnings.length
      ? `\n⚠️ _Warnings: ${escMd(verifyWarnings.slice(0, 2).join("; "))}_`
      : "";

    // Goal refinement suggestion
    const refineLine = goalRefinement
      ? `\n💡 _Suggested goal: "${escMd(goalRefinement)}"_`
      : "";

    // ── Tier 0: auto-execute ──────────────────────────────
    if (tier === 0) {
      return reply(ctx,
        `✅ *Executing* — ${tierLabel}\n` +
        `\`${planId.slice(0, 8)}\` | ${taskPlan.tasks.length} tasks | ~${taskPlan.estimated_duration_minutes}min\n` +
        warnLine + refineLine + `\n\n` +
        taskLines.join("\n")
      );
    }

    // ── Tier 1: auto-approve (internal only) ─────────────
    if (tier === 1) {
      await pg.query(`UPDATE tasks SET status = 'CREATED' WHERE plan_id = $1 AND status = 'PENDING'`, [planId]);
      return reply(ctx,
        `🔵 *Tier 1 — Executing* (internal only)\n` +
        `\`${planId.slice(0, 8)}\` | ${taskPlan.tasks.length} tasks\n` +
        warnLine + `\n\n` +
        taskLines.join("\n")
      );
    }

    // ── Tier 2 & 3: approval token + inline buttons ───────
    if (taskPlan.approval_required) {
      const token = crypto.randomBytes(3).toString("hex").toUpperCase();

      await pg.query(
        `INSERT INTO plan_approvals (plan_id, telegram_user_id, telegram_chat_id, approval_token)
         VALUES ($1, $2, $3, $4) ON CONFLICT (plan_id) DO NOTHING`,
        [planId, String(ctx.from?.id), String(ctx.chat?.id), token]
      );
      await pg.query(
        `UPDATE tasks SET status = 'PENDING', approval_required = true WHERE plan_id = $1`,
        [planId]
      );

      const rollback = taskPlan.rollback_plan
        ? `\n*Rollback:* _${escMd(taskPlan.rollback_plan.slice(0, 120))}_`
        : "";

      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback("✅ APPROVE", `APPROVE:${token}`),
        Markup.button.callback("❌ REJECT",  `REJECT:${token}`),
      ]);

      return reply(ctx,
        `${tier === 3 ? "🔴" : "🟡"} *${tierLabel} — Approval required*\n` +
        `\`${planId.slice(0, 8)}\` | ${taskPlan.tasks.length} tasks | ~${taskPlan.estimated_duration_minutes}min\n\n` +
        `*Goal:* _${escMd(taskPlan.goal.slice(0, 100))}_\n\n` +
        `*Risk:* ${riskIcon} ${taskPlan.risk_level.toUpperCase()}  |  *Categories:* ${escMd(categories)}\n` +
        `*Machines:* ${escMd(machines)}\n` +
        `*Cost est:* $${taskPlan.estimated_cost_usd}\n` +
        (resourceLines.length ? `*Resources:* ${resourceLines.join(" | ")}\n` : "") +
        rollback + warnLine + refineLine + `\n\n` +
        `*Tasks:*\n${taskLines.join("\n")}\n\n` +
        `_Token: \`APPROVE ${token}\` (or tap button above)_`,
        keyboard
      );
    }

    return reply(ctx, `✅ *Plan created*\n\`${planId}\`\n${taskPlan.tasks.length} tasks | $${taskPlan.estimated_cost_usd}`);

  } catch (err) {
    clearInterval(typingInterval);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// MESSAGE ROUTER
// ─────────────────────────────────────────────────────────────

bot.on("text", async (ctx) => {
  const text   = ctx.message?.text?.trim();
  const userId = ctx.from?.id;
  if (!text) return;

  if (text === "/start" || text.toLowerCase() === "start") {
    return handleStart(ctx).catch(console.error);
  }

  const role = await getRole(userId);
  if (!role) {
    return ctx.reply(`⛔ Not authorised. Your ID: \`${userId}\``, { parse_mode: "Markdown" });
  }

  console.log(`[telegram] [${role}] ${userId}: ${text.slice(0, 80)}`);

  try {
    const lower = text.toLowerCase().trim();
    const upper = text.toUpperCase().trim();

    if (lower === "/estop" || lower === "estop")   return await handleEmergencyStop(ctx);
    if (lower === "/resume" || lower === "resume") return await handleResume(ctx);
    if (lower === "help"    || lower === "/help")  return await handleHelp(ctx);
    if (lower === "plans"   || lower === "/plans") return await handlePlans(ctx);
    if (lower === "metrics" || lower === "/metrics") return await handleMetrics(ctx);
    if (lower === "workers" || lower === "/workers") return await handleWorkers(ctx);
    if (lower === "deadletters" || lower === "/deadletters") return await handleDeadLetters(ctx);
    if (lower === "budget"  || lower === "/budget") return await handleBudget(ctx);

    if (lower.startsWith("status ")) return await handleStatus(ctx, text.slice(7).trim());
    if (lower === "status"  || lower === "/status") return await handleStatus(ctx, null);
    if (lower.startsWith("stop "))  return await handleStop(ctx, text.slice(5).trim());

    if (upper.startsWith("APPROVE ")) return await handleApprove(ctx, text.slice(8).trim().toUpperCase());
    if (upper.startsWith("REJECT "))  return await handleReject(ctx, text.slice(7).trim().toUpperCase());
    if (upper.startsWith("CONFIRM ")) return await handleConfirm(ctx, text.slice(8).trim().toUpperCase());

    // Emergency stop blocks new plans
    const emergencyState = await isEmergencyStopped();
    if (emergencyState) {
      return reply(ctx, `🛑 *Emergency stop is active* — new plans are blocked.\n\nType \`/resume\` to re-enable execution.`);
    }

    await handleGoal(ctx, text);

  } catch (err) {
    console.error("[telegram] Handler error:", err);
    await reply(ctx, `❌ Error: ${escMd(err.message)}`).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────
// PLAN COMPLETION NOTIFIER (polls every 15s)
// ─────────────────────────────────────────────────────────────

const _notifiedPlans = new Set();

async function pollPlanCompletions() {
  try {
    const { rows } = await pg.query(
      `SELECT p.id, p.goal, p.status, p.total_tasks, p.completed_tasks,
              p.actual_cost_usd, t.telegram_chat_id
       FROM plans p
       JOIN plan_approvals t ON t.plan_id = p.id
       WHERE p.status IN ('completed','failed')
         AND p.completed_at > NOW() - INTERVAL '60 seconds'`
    );

    for (const plan of rows) {
      if (_notifiedPlans.has(plan.id)) continue;
      _notifiedPlans.add(plan.id);

      const icon = plan.status === "completed" ? "✅" : "❌";
      const cost = plan.actual_cost_usd ? ` $${Number(plan.actual_cost_usd).toFixed(4)}` : "";
      if (!plan.telegram_chat_id) continue;

      await replyDirect(plan.telegram_chat_id,
        `${icon} *Plan ${plan.status}*\n` +
        `\`${plan.id.slice(0, 8)}\` — _${escMd(plan.goal.slice(0, 80))}_\n` +
        `${plan.completed_tasks}/${plan.total_tasks} tasks${cost}`
      );
    }
  } catch (e) {
    console.warn("[notifier] poll error:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// BUDGET THRESHOLD MONITOR (polls every 5min)
// ─────────────────────────────────────────────────────────────

const _budgetAlertedAt = { pct80: false, pct100: false };

async function pollBudget() {
  try {
    const summary = await spendSummary();
    const pct = (summary.spent_usd / summary.daily_cap_usd) * 100;

    if (pct >= 100 && !_budgetAlertedAt.pct100) {
      _budgetAlertedAt.pct100 = true;
      await notifier.notifyBudgetExhausted(summary);
    } else if (pct >= 80 && !_budgetAlertedAt.pct80) {
      _budgetAlertedAt.pct80 = true;
      await notifier.notifyBudgetWarning({ ...summary, threshold_pct: 80 });
    }

    // Reset flags at midnight UTC
    const h = new Date().getUTCHours();
    if (h === 0) { _budgetAlertedAt.pct80 = false; _budgetAlertedAt.pct100 = false; }
  } catch (e) {
    console.warn("[budget_monitor] error:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`[system] ${signal} — shutting down...`);
  await bot.stop(signal);
  console.log("[system] Shutdown complete");
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT",  () => shutdown("SIGINT"));

// ─────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// pg_notify LISTENER
// Replaces the 1-second dispatch polling loop.
// inserter.js fires pg_notify('task_created', planId) after every plan insert.
// This function listens and immediately calls dispatchPendingTasks() — sub-100ms.
// Falls back gracefully to interval polling if LISTEN fails.
// ─────────────────────────────────────────────────────────────

const { setupPgNotifyListener: setupPgNotify } = require("../control/pg-notify");

async function start() {
  console.log("[system] Starting...");
  await recoverStuckTasks();
  console.log("[system] Startup reconciliation complete");
  await startWorker();

  // Attempt pg_notify event-driven dispatch (sub-100ms task start)
  const listenClient = await setupPgNotify(dispatchPendingTasks);

  // Always keep the 5s fallback poll — catches tasks missed if notify drops
  // (5s instead of 1s because pg_notify handles the hot path)
  const dispatchInterval = listenClient ? 5000 : 1000;
  setInterval(() => dispatchPendingTasks().catch(console.error), dispatchInterval);

  setInterval(() => reapStuckTasks().catch(console.error), 60_000);
  setInterval(() => pollPlanCompletions().catch(console.error), 15_000);
  setInterval(() => pollBudget().catch(console.error), 5 * 60_000);

  // dropPendingUpdates: true — if a previous instance still holds the Telegram
  // getUpdates long-poll (e.g. after a SIGKILL), this tells Telegram to discard
  // any pending updates rather than return a 409 Conflict that crashes this instance.
  await bot.launch({ dropPendingUpdates: true });
  console.log("[system] ✅ Ready — Telegraf + pg_notify active");
}

start().catch(console.error);
