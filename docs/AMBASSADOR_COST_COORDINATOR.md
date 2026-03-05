# Ambassador Agent & Cost Coordinator

## Overview

Two critical "immune system" components for OpenClaw:

1. **Ambassador Agent** - Human-in-the-Loop Protocol
2. **Cost Coordinator** - Economic Metabolism (Token & API Governance)

## Ambassador Agent

### Purpose

Formats system state into human-readable briefs and sends them when the system hits conflicts or health issues it can't resolve.

Instead of looking at JSON logs, the Ambassador sends you a message:
> "I've paused SaaS Dev because the Stripe API is returning 401s. I've already checked the config; it looks like the key expired. Should I swap to the sandbox key or wait for you?"

### How It Works

The Ambassador runs as part of the coordinator pulse and:

1. **Monitors system health** - Checks service status, conflicts, resources, and budget
2. **Formats human-readable briefs** - Converts technical state into actionable messages
3. **Deduplicates notifications** - Avoids spam with cooldown periods
4. **Sends via monitoring channels** - Telegram, Discord, Slack

### Example Briefs

**Service Health:**
```
❌ DATABASE is unhealthy (3 consecutive failures)

Error: connection refused

What I checked:
- Connection to 192.168.1.164:15432
- Network reachability

Possible actions:
- Check database server status
- Verify network connectivity
- Check database credentials
```

**Budget Alert:**
```
💰 Budget Alert

Spent today: $18.50 / $20.00 (92.5%)
Remaining: $1.50

⚠️ 3 request(s) blocked due to budget limits

🔴 Critical - Budget nearly exhausted.

Possible actions:
- Raise DAILY_COST_CAP_USD
- Wait until tomorrow
- Review high-cost operations
```

**Agent Conflict:**
```
⚠️ Conflict Detected: duplicate_tasks

12 concurrent tasks of type `saas_development`

What this means:
Multiple agents are trying to do the same work simultaneously.

Possible actions:
- Let the system auto-resolve (recommended)
- Manually cancel duplicate tasks
- Check agent scheduling configuration

🔴 High severity - This may impact system performance.
```

### Configuration

The Ambassador automatically runs as part of `openclaw-coordinator-pulse.js`. No additional configuration needed.

State is stored in:
- `agent-state/ambassador-state.json` - Notification history and cooldowns
- `ambassador_messages` table - Database record of all messages sent

### Manual Escalation

You can manually escalate issues:

```javascript
const { escalateIssue } = require("./control/ambassador-agent");

await escalateIssue("api_error", {
  service: "Stripe",
  error: "401 Unauthorized",
  context: "Payment processing failed during checkout",
});
```

## Cost Coordinator

### Purpose

Circuit breaker for spend. Every agent can "request a budget" from the coordinator before a run. Prevents deterministic loops from burning through API credits.

**Example:**
```
Agent: "I need to run 5,000 tokens on GPT-4o."
Coordinator: "Daily budget is 90% full. Downgrade to Gemini Flash or wait until tomorrow."
```

### How It Works

1. **Proactive Budget Requests** - Agents request approval before expensive operations
2. **Provider-Specific Limits** - Separate budgets for OpenAI, Anthropic, Gemini, DeepSeek
3. **Alternative Suggestions** - Automatically suggests cheaper models when rejected
4. **Circuit Breaker** - Throttles non-critical requests at 95% budget

### Usage

#### Request Budget Before Model Call

```javascript
const { requestBudget } = require("./control/cost-coordinator");

// Before making an expensive model call
const budgetRequest = await requestBudget({
  model_id: "gpt-4o",
  estimated_tokens_in: 5000,
  estimated_tokens_out: 2000,
  task_type: "saas_development",
  agent_id: "saas_dev",
});

if (!budgetRequest.approved) {
  console.log(`Budget rejected: ${budgetRequest.reason}`);
  console.log(`Alternatives:`, budgetRequest.alternatives);
  
  // Use an alternative model
  if (budgetRequest.alternatives && budgetRequest.alternatives.length > 0) {
    const alt = budgetRequest.alternatives[0];
    console.log(`Using alternative: ${alt.model_id} (saves $${alt.savings.toFixed(4)})`);
    // ... use alt.model_id instead
  }
} else {
  console.log(`Budget approved: $${budgetRequest.estimated_cost.toFixed(4)}`);
  if (budgetRequest.warning) {
    console.warn(`Warning: ${budgetRequest.message}`);
  }
  // ... proceed with model call
}
```

#### Check Budget State

```javascript
const { getBudgetState } = require("./control/cost-coordinator");

const state = await getBudgetState();
console.log(`Daily: $${state.daily_spent.toFixed(2)} / $${state.daily_cap.toFixed(2)}`);
console.log(`OpenAI: $${state.provider_budgets.openai.spent.toFixed(2)} / $${state.provider_budgets.openai.cap.toFixed(2)}`);
```

#### Check Circuit Breaker

```javascript
const { shouldThrottle } = require("./control/cost-coordinator");

const throttle = await shouldThrottle();
if (throttle.throttled) {
  console.log(`Circuit breaker active: ${throttle.message}`);
  // Only allow critical requests
} else if (throttle.level === "warning") {
  console.warn(`Budget warning: ${throttle.message}`);
  // Consider throttling non-essential requests
}
```

### Configuration

Environment variables:

```bash
# Daily budget caps
DAILY_COST_CAP_USD=20          # Total daily spend cap
PLAN_COST_CAP_USD=5            # Per-plan cost cap

# Provider-specific caps
OPENAI_DAILY_BUDGET_USD=10
ANTHROPIC_DAILY_BUDGET_USD=12
GEMINI_DAILY_BUDGET_USD=8
DEEPSEEK_DAILY_BUDGET_USD=8
```

### Database Tables

- `cost_coordinator_blocks` - Records all blocked requests
- `cost_coordinator_requests` - Tracks all budget requests (approved and blocked)

### Integration with Model Router

The Cost Coordinator works alongside the existing budget system in `model-router.js`. The existing budget checks still work as a fallback, but agents can proactively request approval for better control.

## Benefits

### Ambassador Agent

1. **Human-Readable Communication** - No more parsing JSON logs
2. **Actionable Briefs** - Each message includes "What I checked" and "Possible actions"
3. **Deduplication** - Avoids notification spam with smart cooldowns
4. **Priority-Based** - High-priority issues are sent first

### Cost Coordinator

1. **Proactive Governance** - Request approval before spending, not after
2. **Provider Isolation** - Separate budgets prevent one provider from exhausting all funds
3. **Automatic Alternatives** - Suggests cheaper models when budget is tight
4. **Circuit Breaker** - Prevents runaway spending at 95% threshold

## Monitoring

### Ambassador Messages

View recent messages:
```sql
SELECT issue_type, priority, message, created_at
FROM ambassador_messages
ORDER BY created_at DESC
LIMIT 10;
```

### Cost Coordinator Blocks

View blocked requests:
```sql
SELECT model_id, provider, estimated_cost, reason, agent_id, created_at
FROM cost_coordinator_blocks
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Budget State

The coordinator pulse logs budget state:
```
[6/6] Budget & Ambassador...
  Daily spend: $18.50 / $20.00 (92.5%)
  Throttle level: warning
  Blocked requests today: 3
  Ambassador briefs sent: 1
```

## Next Steps

1. **Evolutionary Prompt Registry** - A/B self-optimization (future)
2. **Semantic Conflict Detection** - Intent-based conflict prevention (future)
3. **Agent Shadowing** - Peer review layer for high-stakes tasks (future)

## See Also

- `control/ambassador-agent.js` - Ambassador implementation
- `control/cost-coordinator.js` - Cost Coordinator implementation
- `scripts/openclaw-coordinator-pulse.js` - Main coordination pulse
- `migrations/073_cost_coordinator_ambassador.sql` - Database schema
