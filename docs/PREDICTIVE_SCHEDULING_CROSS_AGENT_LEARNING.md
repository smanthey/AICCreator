# Predictive Scheduling & Cross-Agent Learning

## Overview

OpenClaw now includes two advanced features that move the system from **reactive** to **proactive**:

1. **Predictive Scheduling** - Predicts optimal execution times using Golden Window algorithm
2. **Cross-Agent Learning** - Agents share knowledge and adapt based on system-wide signals

## 1. Predictive Scheduling

### The Golden Window Algorithm

Instead of fixed cron schedules, agents now run at predicted optimal times based on:
- Historical success rates
- Resource utilization patterns
- Time-of-day performance data

### How It Works

1. **Performance Logging**: Every agent run logs metrics to `agent-state/performance.ndjson`
   - Execution time
   - Outcome (success/fail/timeout)
   - Resource utilization

2. **Time Buckets**: Day is divided into 96 buckets (15-minute intervals)
   - Each bucket gets a readiness score
   - Score = (0.7 × success_rate) - (0.3 × resource_utilization)

3. **Golden Window Selection**: 
   - Coordinator looks at next 4 buckets
   - If current bucket score < 0.8, agent defers to best bucket
   - Prevents "resource storms" from aligned cron schedules

### Usage

```javascript
const { getGoldenWindow, logPerformanceMetric } = require("./control/predictive-scheduler");

// Log performance after agent run
await logPerformanceMetric({
  agent_id: "saas_development",
  execution_time_ms: 45000,
  outcome: "success",
  resource_utilization: 65,
});

// Check Golden Window before running
const window = await getGoldenWindow("saas_development");
if (window.should_defer) {
  // Defer to better time
  console.log(`Deferring to bucket ${window.defer_to_bucket}`);
}
```

### Benefits

- **Prevents Resource Storms**: Spreads load naturally
- **Higher Success Rates**: Agents run when conditions are optimal
- **Adaptive**: Learns from historical patterns

## 2. Cross-Agent Learning

### Shared Context Store

Agents emit signals that other agents can learn from:
- Entity changes (files, modules, services)
- Error patterns
- Performance issues
- Success patterns

### Signal Structure

```json
{
  "origin_agent_id": "saas_dev_agent",
  "entities_touched": ["auth-module", "stripe-api"],
  "sentiment": "negative",
  "error_type": "rate_limit_exceeded",
  "priority": "high"
}
```

### Cross-Pollination Examples

1. **Rate Limit Detection**:
   - SaaS Dev agent hits rate limit
   - Affiliate Research agent automatically reduces priority
   - System Admin agent triggers proxy rotation check

2. **Error Pattern Learning**:
   - Multiple agents report high LLM latency
   - System globally reduces concurrency limit
   - Timeouts increased by 1.5x

3. **Entity Health Tracking**:
   - Negative sentiment on "auth-module"
   - Code Review agent prioritizes auth-related tasks
   - Debugging agent focuses on auth issues

### Usage

```javascript
const { emitSignal, getRelevantSignals, getAdaptiveThresholds } = require("./control/cross-agent-learning");

// Emit signal after task completion
await emitSignal({
  origin_agent_id: "saas_development",
  entities_touched: ["auth-module"],
  sentiment: "negative",
  error_type: "rate_limit_exceeded",
  priority: "high",
});

// Get relevant signals before running
const signals = await getRelevantSignals({
  agent_id: "affiliate_research",
  entities: ["stripe-api"],
  lookback_minutes: 60,
});

// Get adaptive thresholds
const thresholds = await getAdaptiveThresholds();
if (thresholds.concurrency_limit === "reduced") {
  // Adjust behavior
}
```

## 3. Risk Mitigations

### Coordinator SPOF (Single Point of Failure)

**Solution**: Coordinator Watchdog
- Monitors coordinator health every 10 minutes
- If stale > 10 minutes, agents enter "safe mode"
- Only critical agents run in safe mode
- Watchdog attempts to restart coordinator

**Implementation**: `control/coordinator-watchdog.js` + `scripts/coordinator-watchdog-pulse.js`

### State Race Conditions

**Solution**: Atomic File Operations
- All state writes use atomic write-to-temp-then-rename
- Redis-based locking for read-modify-write operations
- Prevents file corruption from concurrent writes

**Implementation**: `control/atomic-state.js`

### 5-Minute Pulse Latency

**Solution**: Fast-Track Health Check
- Agents get <1s health check before execution
- Checks database + coordinator staleness
- Full coordination check only if fast check passes

**Implementation**: `fastHealthCheck()` in `coordinator-watchdog.js`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│         Coordinator Pulse (every 5 min)                │
│  - System Health Coordination                           │
│  - Research Coordination                                │
│  - Predictive Scheduling Update                         │
│  - Cross-Agent Learning                                 │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                     │
┌───────▼────────┐                  ┌─────────▼──────────┐
│ Predictive      │                  │ Cross-Agent      │
│ Scheduler       │                  │ Learning         │
│                 │                  │                   │
│ - Performance   │                  │ - Signal Store    │
│   Logging       │                  │ - Shared          │
│ - Golden Window │                  │   Knowledge       │
│ - Schedule      │                  │ - Cross-          │
│   Weights       │                  │   Pollination     │
└───────┬────────┘                  └─────────┬──────────┘
        │                                     │
        └─────────────────┬───────────────────┘
                          │
        ┌─────────────────▼───────────────────┐
        │  Agent Execution Decision           │
        │  - Fast health check (<1s)          │
        │  - Golden Window check              │
        │  - Cross-agent signals              │
        │  - Full coordination                │
        └─────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
┌───────▼────────┐                  ┌───────▼──────────┐
│ Mission Control│                  │ Watchdog         │
│ Agents         │                  │ (every 10 min)  │
│                │                  │                  │
│ - Log perf     │                  │ - Monitor        │
│ - Emit signals │                  │   coordinator    │
│ - Check Golden │                  │ - Safe mode      │
│   Window       │                  │   detection      │
└────────────────┘                  └─────────────────┘
```

## Data Flow

### Performance Logging

```
Agent Run → logPerformanceMetric() → performance.ndjson
                                    ↓
                          updateScheduleWeights()
                                    ↓
                          schedule-weights.json
```

### Signal Flow

```
Agent Run → emitSignal() → Redis (shared_knowledge)
                          ↓
                  updateSharedKnowledge()
                          ↓
                  crossPollinateSignals()
                          ↓
              Other agents read signals
```

## Configuration

### Predictive Scheduling

- `WEIGHT_SUCCESS`: 0.7 (weight for success rate)
- `WEIGHT_RESOURCE`: 0.3 (weight for resource utilization)
- `BUCKET_SIZE_MINUTES`: 15 (time bucket size)
- `READINESS_THRESHOLD`: 0.8 (minimum score to run)

### Cross-Agent Learning

- `SIGNAL_TTL_SECONDS`: 3600 (signals expire after 1 hour)
- `SHARED_KNOWLEDGE_KEY`: "shared_knowledge" (Redis key)
- `SIGNAL_QUEUE_KEY`: "agent_signals" (Redis list)

## Monitoring

### Performance Metrics

Check performance log:
```bash
tail -f agent-state/performance.ndjson | jq
```

### Schedule Weights

View current weights:
```bash
cat agent-state/schedule-weights.json | jq
```

### Shared Knowledge

Query Redis:
```bash
redis-cli GET shared_knowledge | jq
```

### Coordinator Health

Check watchdog logs:
```bash
pm2 logs claw-coordinator-watchdog
```

## Benefits

### Before (Reactive)
- Fixed cron schedules
- No learning from history
- Resource storms at aligned times
- Agents unaware of each other

### After (Proactive)
- Adaptive scheduling based on patterns
- Cross-agent knowledge sharing
- Natural load distribution
- System-wide awareness

## Next Steps

1. **ML Enhancement**: Use ML models for better predictions
2. **Predictive Failure Detection**: Predict failures before they happen
3. **Auto-Tuning**: Automatically adjust weights based on outcomes
4. **Multi-Agent Coordination**: Agents coordinate complex workflows
