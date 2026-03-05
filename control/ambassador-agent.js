"use strict";

/**
 * control/ambassador-agent.js
 * 
 * Ambassador Agent - Human-in-the-Loop Protocol
 * 
 * Purpose: Formats system state into human-readable briefs and sends them
 * when the system hits conflicts or health issues it can't resolve.
 * 
 * Instead of looking at JSON logs, the Ambassador sends you a message:
 * "I've paused SaaS Dev because the Stripe API is returning 401s. 
 *  I've already checked the config; it looks like the key expired. 
 *  Should I swap to the sandbox key or wait for you?"
 * 
 * Why: Turns "System Admin" from a chore into a high-level conversation.
 */

const { notifyMonitoring } = require("./monitoring-notify");
const pg = require("../infra/postgres");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const AMBASSADOR_STATE_FILE = path.join(ROOT, "agent-state", "ambassador-state.json");

// Track what we've already notified about to avoid spam
let notificationState = {
  last_notified: {},
  notification_history: [],
};

/**
 * Load notification state to avoid duplicate alerts
 */
async function loadNotificationState() {
  try {
    const data = await fsp.readFile(AMBASSADOR_STATE_FILE, "utf8");
    notificationState = JSON.parse(data);
  } catch {
    notificationState = {
      last_notified: {},
      notification_history: [],
    };
  }
}

/**
 * Save notification state
 */
async function saveNotificationState() {
  await fsp.mkdir(path.dirname(AMBASSADOR_STATE_FILE), { recursive: true });
  await fsp.writeFile(AMBASSADOR_STATE_FILE, JSON.stringify(notificationState, null, 2));
}

/**
 * Check if we should notify about this issue (avoid spam)
 */
function shouldNotify(issueKey, cooldownMinutes = 30) {
  const lastNotified = notificationState.last_notified[issueKey];
  if (!lastNotified) return true;
  
  const minutesSince = (Date.now() - new Date(lastNotified).getTime()) / 60000;
  return minutesSince >= cooldownMinutes;
}

/**
 * Format a service health issue into a human-readable brief
 */
function formatServiceHealthBrief(service, health) {
  const status = health.status === "healthy" ? "✅" : "❌";
  const failures = health.consecutive_failures || 0;
  
  if (health.status === "healthy") {
    return null; // Don't notify about healthy services
  }
  
  let message = `${status} *${service.toUpperCase()}* is ${health.status}`;
  
  if (failures >= 3) {
    message += ` (${failures} consecutive failures)`;
  }
  
  if (health.error) {
    message += `\n\nError: \`${health.error.slice(0, 200)}\``;
  }
  
  // Add context-specific recommendations
  if (service === "database") {
    message += `\n\n*What I checked:*\n- Connection to ${process.env.POSTGRES_HOST || "database"}`;
    message += `\n- Network reachability`;
    message += `\n\n*Possible actions:*\n- Check database server status`;
    message += `\n- Verify network connectivity`;
    message += `\n- Check database credentials`;
  } else if (service === "redis") {
    message += `\n\n*What I checked:*\n- Connection to ${process.env.REDIS_HOST || "redis"}`;
    message += `\n- Redis ping response`;
    message += `\n\n*Possible actions:*\n- Check Redis server status`;
    message += `\n- Verify Redis is running`;
    message += `\n- Check Redis memory usage`;
  } else if (service === "ollama") {
    message += `\n\n*What I checked:*\n- Ollama API at localhost:11434`;
    message += `\n- Model availability`;
    message += `\n\n*Possible actions:*\n- Check Ollama service status`;
    message += `\n- Verify models are loaded`;
    message += `\n- Restart Ollama if needed`;
  }
  
  return message;
}

/**
 * Format an agent conflict into a human-readable brief
 */
function formatConflictBrief(conflict) {
  let message = `⚠️ *Conflict Detected: ${conflict.type}*\n\n`;
  
  if (conflict.type === "duplicate_tasks") {
    message += `${conflict.count} concurrent tasks of type \`${conflict.task_type}\``;
    message += `\n\n*What this means:*\nMultiple agents are trying to do the same work simultaneously.`;
    message += `\n\n*Possible actions:*\n- Let the system auto-resolve (recommended)`;
    message += `\n- Manually cancel duplicate tasks`;
    message += `\n- Check agent scheduling configuration`;
  } else {
    message += conflict.message || "Unknown conflict type";
  }
  
  if (conflict.severity === "high") {
    message += `\n\n🔴 *High severity* - This may impact system performance.`;
  }
  
  return message;
}

/**
 * Format a resource issue into a human-readable brief
 */
function formatResourceBrief(resources) {
  const issues = [];
  
  if (resources.queue?.total_pending > 100) {
    issues.push(`Queue backlog: ${resources.queue.total_pending} pending tasks`);
  }
  
  if (resources.devices?.online === 0) {
    issues.push("No online devices available");
  }
  
  if (resources.devices?.utilization && parseFloat(resources.devices.utilization) > 90) {
    issues.push(`Device utilization: ${resources.devices.utilization}% (very high)`);
  }
  
  if (issues.length === 0) return null;
  
  let message = `📊 *Resource Alert*\n\n${issues.join("\n")}`;
  message += `\n\n*Possible actions:*\n- Wait for queue to process`;
  message += `\n- Check device availability`;
  message += `\n- Scale up resources if needed`;
  
  return message;
}

/**
 * Format a budget/cost issue into a human-readable brief
 */
function formatBudgetBrief(budgetState) {
  if (!budgetState) return null;
  // Normalize: cost-coordinator uses daily_spent/daily_cap, budget.js uses spent_usd/daily_cap_usd
  const spent = budgetState.spent_usd ?? budgetState.daily_spent ?? 0;
  const cap = budgetState.daily_cap_usd ?? budgetState.daily_cap ?? 1;
  const remaining = budgetState.remaining_usd ?? budgetState.daily_remaining ?? (cap - spent);
  const percentage = budgetState.daily_percentage ?? (cap > 0 ? (spent / cap) * 100 : 0);
  
  if (percentage < 80) return null; // Don't notify unless we're getting close
  
  let message = `💰 *Budget Alert*\n\n`;
  message += `Spent today: $${Number(spent).toFixed(2)} / $${Number(cap).toFixed(2)} (${Number(percentage).toFixed(1)}%)`;
  message += `\nRemaining: $${Number(remaining).toFixed(2)}`;
  
  const blocked_requests = budgetState.blocked_requests;
  if (blocked_requests && blocked_requests > 0) {
    message += `\n\n⚠️ ${blocked_requests} request(s) blocked due to budget limits`;
  }
  
  if (percentage >= 95) {
    message += `\n\n🔴 *Critical* - Budget nearly exhausted.`;
    message += `\n\n*Possible actions:*\n- Raise DAILY_COST_CAP_USD`;
    message += `\n- Wait until tomorrow`;
    message += `\n- Review high-cost operations`;
  } else if (percentage >= 80) {
    message += `\n\n⚠️ *Warning* - Budget getting low.`;
    message += `\n\n*Possible actions:*\n- Monitor spending closely`;
    message += `\n- Consider raising budget if needed`;
  }
  
  return message;
}

/**
 * Format an agent execution decision into a brief
 */
function formatAgentBlockBrief(agent, decision) {
  if (decision.should_run) return null;
  
  let message = `🚫 *Agent Blocked: ${agent.agent_name || agent.agent_id}*\n\n`;
  message += `Reason: ${decision.reason}`;
  message += `\nPriority: ${decision.priority}`;
  
  if (decision.priority === "high") {
    message += `\n\n🔴 *High priority block* - This agent cannot run until the issue is resolved.`;
  }
  
  return message;
}

/**
 * Generate a comprehensive state brief from system health data
 */
async function generateStateBrief(healthState, budgetState = null) {
  const briefs = [];
  
  // Service health issues
  for (const [service, health] of Object.entries(healthState.services || {})) {
    if (health.status !== "healthy") {
      const brief = formatServiceHealthBrief(service, health);
      if (brief) {
        const issueKey = `service:${service}:${health.status}`;
        if (shouldNotify(issueKey, 30)) {
          briefs.push({
            type: "service_health",
            service,
            priority: health.consecutive_failures >= 3 ? "high" : "medium",
            message: brief,
            issueKey,
          });
        }
      }
    }
  }
  
  // Conflicts
  for (const conflict of healthState.conflicts || []) {
    const brief = formatConflictBrief(conflict);
    if (brief) {
      const issueKey = `conflict:${conflict.type}:${conflict.task_type || "unknown"}`;
      if (shouldNotify(issueKey, 15)) {
        briefs.push({
          type: "conflict",
          priority: conflict.severity === "high" ? "high" : "medium",
          message: brief,
          issueKey,
        });
      }
    }
  }
  
  // Resource issues
  if (healthState.resources) {
    const brief = formatResourceBrief(healthState.resources);
    if (brief) {
      const issueKey = `resources:${healthState.resources.queue?.total_pending || 0}`;
      if (shouldNotify(issueKey, 60)) {
        briefs.push({
          type: "resources",
          priority: "medium",
          message: brief,
          issueKey,
        });
      }
    }
  }
  
  // Budget issues
  if (budgetState) {
    const brief = formatBudgetBrief(budgetState);
    if (brief) {
      const spent = budgetState.spent_usd ?? budgetState.daily_spent ?? 0;
      const cap = budgetState.daily_cap_usd ?? budgetState.daily_cap ?? 1;
      const issueKey = `budget:${Number(spent).toFixed(2)}`;
      if (shouldNotify(issueKey, 30)) {
        briefs.push({
          type: "budget",
          priority: cap > 0 && spent / cap >= 0.95 ? "high" : "medium",
          message: brief,
          issueKey,
        });
      }
    }
  }
  
  // Agent blocks (only high priority)
  if (healthState.schedule_recommendations) {
    for (const agent of healthState.schedule_recommendations) {
      if (!agent.should_run && agent.priority === "high") {
        const brief = formatAgentBlockBrief(agent, agent);
        if (brief) {
          const issueKey = `agent_block:${agent.agent_id}:${agent.priority}`;
          if (shouldNotify(issueKey, 60)) {
            briefs.push({
              type: "agent_block",
              agent_id: agent.agent_id,
              priority: "high",
              message: brief,
              issueKey,
            });
          }
        }
      }
    }
  }
  
  return briefs;
}

/**
 * Send state briefs to human operators
 */
async function sendStateBriefs(briefs) {
  if (!briefs || briefs.length === 0) {
    return { sent: 0, skipped: 0 };
  }
  
  // Sort by priority (high first)
  briefs.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
  });
  
  let sent = 0;
  let skipped = 0;
  
  for (const brief of briefs) {
    try {
      // Mark as notified
      notificationState.last_notified[brief.issueKey] = new Date().toISOString();
      notificationState.notification_history.push({
        issueKey: brief.issueKey,
        type: brief.type,
        priority: brief.priority,
        sent_at: new Date().toISOString(),
        message_preview: brief.message.slice(0, 100),
      });
      
      // Keep history to last 100 entries
      if (notificationState.notification_history.length > 100) {
        notificationState.notification_history = notificationState.notification_history.slice(-100);
      }
      
      // Send notification
      const result = await notifyMonitoring(brief.message);
      
      if (result.sent) {
        sent++;
        console.log(`[ambassador] Sent ${brief.type} brief (${brief.priority} priority)`);
      } else {
        skipped++;
        console.log(`[ambassador] Failed to send ${brief.type} brief: ${result.results?.map(r => r.error || r.status).join(", ")}`);
      }
      
      // Small delay between messages to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (err) {
      console.error(`[ambassador] Error sending brief:`, err.message);
      skipped++;
    }
  }
  
  await saveNotificationState();
  
  return { sent, skipped };
}

/**
 * Main function: Generate and send state briefs
 */
async function runAmbassadorCycle(healthState, budgetState = null) {
  await loadNotificationState();
  
  console.log("[ambassador] Generating state briefs...");
  const briefs = await generateStateBrief(healthState, budgetState);
  
  console.log(`[ambassador] Generated ${briefs.length} brief(s)`);
  
  if (briefs.length > 0) {
    const result = await sendStateBriefs(briefs);
    console.log(`[ambassador] Sent ${result.sent} brief(s), skipped ${result.skipped}`);
    return result;
  }
  
  return { sent: 0, skipped: 0 };
}

/**
 * Generate a one-off brief for a specific issue (for manual escalation)
 */
async function escalateIssue(issueType, issueData) {
  await loadNotificationState();
  
  let message = "";
  
  if (issueType === "api_error") {
    const { service, error, context } = issueData;
    message = `🔴 *API Error: ${service}*\n\n`;
    message += `Error: \`${error}\``;
    if (context) {
      message += `\n\n*Context:*\n${context}`;
    }
    message += `\n\n*What I checked:*\n- API endpoint connectivity`;
    message += `\n- Authentication credentials`;
    message += `\n- Request format`;
    message += `\n\n*Possible actions:*\n- Check API key expiration`;
    message += `\n- Verify service status`;
    message += `\n- Review recent configuration changes`;
  } else if (issueType === "task_failure") {
    const { task_id, task_type, error, attempts } = issueData;
    message = `❌ *Task Failed: ${task_type}*\n\n`;
    message += `Task ID: \`${task_id}\``;
    message += `\nAttempts: ${attempts || 1}`;
    message += `\nError: \`${error?.slice(0, 300)}\``;
    message += `\n\n*Possible actions:*\n- Review task payload`;
    message += `\n- Check dependencies`;
    message += `\n- Retry manually if needed`;
  }
  
  if (message) {
    const result = await notifyMonitoring(message);
    return result;
  }
  
  return { sent: false, error: "Unknown issue type" };
}

module.exports = {
  runAmbassadorCycle,
  generateStateBrief,
  sendStateBriefs,
  escalateIssue,
  loadNotificationState,
  saveNotificationState,
};
