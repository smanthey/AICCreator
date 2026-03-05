# Self-Healing & Auto-Improvement System

## Overview

The OpenClaw bot collection system is now **self-healing** and **auto-improving**, ensuring it can recover from failures and continuously optimize itself to reach the goal of 100-300k credits in 3 months.

## Self-Healing Capabilities

### 1. Health Monitoring

**Automatic health checks** run at the start of each cycle:
- Database connectivity
- Ollama availability
- DeepSeek API status
- Gemini API status

**Health metrics tracked:**
- Service status (healthy/unhealthy)
- Response latency
- Consecutive failures
- Last check timestamp

### 2. Circuit Breakers

**Prevents cascading failures:**
- Automatically opens after 5 consecutive failures
- Blocks requests for 60 seconds (configurable)
- Half-open state allows one test request
- Closes automatically on success

**Services protected:**
- Database connections
- Ollama API calls
- DeepSeek API calls
- Gemini API calls
- Discovery operations
- Outreach operations

### 3. Automatic Recovery

**Auto-recovery mechanisms:**
- **Database**: Automatic reconnection attempts
- **Ollama**: Health check and restart detection
- **API Services**: Fallback to alternative providers
- **Rate Limits**: Exponential backoff with jitter

### 4. Retry Logic

**Intelligent retry with exponential backoff:**
- Max 3 attempts by default
- Initial delay: 1 second
- Max delay: 30 seconds
- Factor: 2x per attempt
- Respects circuit breakers

**Error handling:**
- Rate limits (429) → Back off and retry
- Temporary errors (5xx) → Retry with backoff
- Permanent errors (4xx) → Fail immediately
- Connection errors → Retry with backoff

## Auto-Improvement Capabilities

### 1. Performance Tracking

**Metrics automatically tracked:**
- Conversion rates
- Daily revenue
- Outreach volume
- Discovery counts
- Goal progress
- Health check results

**Trend analysis:**
- 7-day rolling averages
- Min/max values
- Trend direction (↑/↓/→)
- Recent performance (last 10 values)

### 2. Strategy Optimization

**Automatic strategy analysis:**
- Success rate tracking
- Conversion rate analysis
- Revenue per strategy
- AI-powered improvement suggestions

**Optimization loop:**
1. Track strategy performance
2. Analyze results with AI
3. Generate improvement suggestions
4. Apply changes automatically
5. Monitor impact

### 3. Parameter Auto-Tuning

**Automatically adjusts:**
- **Outreach**: Daily limits, batch sizes, delays
- **Discovery**: Daily limits, priority thresholds, sources
- **Messaging**: Personalization level, test variants, message length
- **Learning**: Sample thresholds, confidence levels, frequency

**Tuning logic:**
- Low conversion → Increase personalization
- High conversion → Scale up outreach
- Low daily conversions → Increase discovery
- Performance degradation → Adjust parameters

### 4. Learning from Failures

**Failure analysis:**
- Patterns by platform
- Patterns by message variant
- Common failure reasons
- Root cause analysis

**AI-powered insights:**
- Why failures happen
- What to avoid
- How to improve
- Specific changes to make

### 5. Goal Tracking & Adjustment

**Automatic goal monitoring:**
- Current progress vs target
- Daily needed vs actual
- On-track status (80% threshold)
- Projection adjustments

**Auto-adjustments:**
- Increase outreach if behind
- Optimize messaging if low conversion
- Scale discovery if low volume
- Adjust strategies based on progress

## Integration

### Autonomous Agent Cycle

The self-healing and auto-improvement systems are integrated into every cycle:

```
Step 0: Health Check & Self-Healing
  ├─ Run health checks
  ├─ Attempt recovery if needed
  └─ Load tuned parameters

Step 1-8: Normal operations (with retry & circuit breakers)
  ├─ All operations wrapped in retryWithBackoff
  ├─ Circuit breakers prevent cascading failures
  └─ Performance metrics tracked

Step 5.5: Auto-Improvement Cycle
  ├─ Analyze performance
  ├─ Tune parameters
  ├─ Learn from failures
  └─ Track goal progress
```

### Error Recovery Flow

```
Error Detected
  ├─ Check circuit breaker
  │   ├─ Open → Skip (prevent cascade)
  │   └─ Closed → Continue
  ├─ Retry with backoff
  │   ├─ Success → Record success, continue
  │   └─ Failure → Record failure
  ├─ Circuit breaker opens after threshold
  └─ Health check triggers recovery
```

## Configuration

### Environment Variables

```bash
# Health check intervals (default: every cycle)
HEALTH_CHECK_INTERVAL=3600000  # 1 hour

# Circuit breaker thresholds
CIRCUIT_BREAKER_THRESHOLD=5    # Failures before opening
CIRCUIT_BREAKER_TIMEOUT=60000  # 60 seconds

# Retry configuration
MAX_RETRY_ATTEMPTS=3
INITIAL_RETRY_DELAY=1000
MAX_RETRY_DELAY=30000
RETRY_BACKOFF_FACTOR=2
```

### Parameter Files

Parameters are stored in `agent-state/bot-improvement/parameters.json` and automatically tuned based on performance.

## Monitoring

### Health Log

Health events are logged to `agent-state/bot-health/health-log.jsonl`:
- Circuit breaker state changes
- Service health changes
- Recovery attempts
- Error events

### Performance Metrics

Metrics stored in `agent-state/bot-improvement/metrics.json`:
- Time-series data for all metrics
- Last 1000 entries per metric
- Automatic trend analysis

### Strategy Improvements

Strategy analysis stored in `agent-state/bot-improvement/strategies.json`:
- Performance analysis
- AI suggestions
- Improvement history
- Last 50 improvements per strategy

## Benefits

1. **Resilience**: System automatically recovers from failures
2. **Optimization**: Continuously improves performance
3. **Adaptability**: Adjusts to changing conditions
4. **Efficiency**: Prevents wasted resources on failing services
5. **Learning**: Gets smarter over time
6. **Goal-Oriented**: Automatically adjusts to reach targets

## Example Flow

```
Cycle 1:
  - Health: All services healthy
  - Discovery: 100 bots found
  - Outreach: 50 messages sent
  - Conversion: 2% (1 conversion)
  - Auto-tune: Increase personalization (low conversion)

Cycle 2:
  - Health: Database slow (recovered automatically)
  - Discovery: 150 bots found (increased limit)
  - Outreach: 75 messages sent (increased limit)
  - Conversion: 3% (2 conversions) ← Improved!
  - Auto-tune: Scale up outreach (conversion improving)

Cycle 3:
  - Health: All services healthy
  - Discovery: 200 bots found
  - Outreach: 100 messages sent
  - Conversion: 4% (4 conversions) ← Improving!
  - Goal: 12% progress, on track ✅
```

## Maintenance

The system is fully autonomous and requires no manual intervention. However, you can:

1. **Monitor health**: Check `agent-state/bot-health/health-log.jsonl`
2. **Review metrics**: Check `agent-state/bot-improvement/metrics.json`
3. **View improvements**: Check `agent-state/bot-improvement/strategies.json`
4. **Adjust parameters**: Edit `agent-state/bot-improvement/parameters.json` (will be auto-tuned)

## Future Enhancements

- [ ] Predictive failure detection
- [ ] Automatic service restart (PM2 integration)
- [ ] Multi-agent coordination for recovery
- [ ] Advanced ML-based parameter tuning
- [ ] Cross-system learning (learn from other agents)
