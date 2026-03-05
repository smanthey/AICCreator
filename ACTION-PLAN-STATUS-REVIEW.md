# Action Plan: Status Review Issues

**Date:** 2026-03-01  
**Status:** In Progress  
**Priority:** High

## Executive Summary

This document addresses the critical issues identified in the status review:
- Schema integrity gaps (missing foreign keys, missing tables)
- Code duplication (ensureSchema functions vs migrations)
- Security critical findings (3 immediate priorities)
- Worker restart rate (8/day vs <5/day target)
- Uptime gap (88% vs 99.5% target)

---

## 1. Schema Integrity Fixes ✅

### 1.1 Missing Foreign Keys - FIXED

**Migration Created:** `migrations/078_schema_foreign_key_hardening.sql`

**Foreign Keys Added:**
- `content_items.brand_slug` → `brands.slug`
- `content_items.plan_id` → `plans.id` (if plans table exists)
- `content_items.task_id` → `tasks.id`
- `content_briefs.brand_slug` → `brands.slug`
- `content_briefs.plan_id` → `plans.id` (if plans table exists)
- `content_briefs.task_id` → `tasks.id`
- `leads.brand_slug` → `brands.slug`
- `leads.plan_id` → `plans.id` (if plans table exists)
- `leads.task_id` → `tasks.id`
- `email_sends.brand_slug` → `brands.slug`
- `email_sends.plan_id` → `plans.id` (if plans table exists)
- `email_sends.task_id` → `tasks.id`

**Indexes Added:**
- Performance indexes on all brand_slug columns for FK lookups

**Next Steps:**
1. Run migration: `psql -h 192.168.1.164 -p 15432 -U claw -d claw_architect -f migrations/078_schema_foreign_key_hardening.sql`
2. Verify no orphaned data exists before applying constraints
3. Test application functionality after FK constraints are active

### 1.2 Missing bot_conversion_events Table

**Status:** Migration exists (`migrations/075_bot_collection_schema_fixes.sql`)

**Action Required:**
1. Verify migration 075 has been applied to production
2. If not applied, run: `psql -h 192.168.1.164 -p 15432 -U claw -d claw_architect -f migrations/075_bot_collection_schema_fixes.sql`
3. Confirm table exists: `SELECT COUNT(*) FROM bot_conversion_events;`

---

## 2. Code Duplication: ensureSchema() Functions

### 2.1 Scripts with Direct Table Creation

**Files Identified:**
- `scripts/clawhub-skill-factory.js` (lines 526-570)
- `scripts/agency-growth-os.js` (lines 56-119)
- `scripts/marketplace-services-os.js` (lines 183-238)
- `control/quantfusion-trading-ops.js` (lines 53-159)
- `control/finance-ops.js`
- `scripts/google-maps-scraper.js`

### 2.2 Migration Strategy

**Priority 1: ClawHub Skill Factory**
- Tables: `clawhub_skill_catalog`, `clawhub_skill_sales`, `clawhub_skill_feedback`
- Migration exists: `migrations/068_clawhub_skill_factory.sql`
- **Action:** Update script to check for migration instead of creating tables

**Priority 2: Agency Growth OS**
- Tables: `agency_accounts`, `agency_deals`, `agency_case_studies`, `agency_activities`
- Migration exists: `migrations/067_agency_growth_os.sql`
- **Action:** Update script to check for migration instead of creating tables

**Priority 3: Marketplace Services OS**
- Tables: `marketplace_services`, `marketplace_jobs`
- Migration exists: `migrations/069_marketplace_services_os.sql`
- **Action:** Update script to check for migration instead of creating tables

**Priority 4: QuantFusion Trading**
- Tables: `quantfusion_trading_signals`, `quantfusion_trades`
- Migration exists: `migrations/072_quantfusion_trading_core.sql`
- **Action:** Update script to check for migration instead of creating tables

### 2.3 Recommended Pattern

Replace `ensureSchema()` with migration check:

```javascript
async function ensureSchema() {
  // Check if migration has been applied
  const { rows } = await pg.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'clawhub_skill_catalog'
    ) as exists
  `);
  
  if (!rows[0].exists) {
    throw new Error('Migration 068_clawhub_skill_factory.sql must be applied first');
  }
}
```

---

## 3. Security Critical Findings (Top 3 Priorities)

### 3.1 C1: Unauthenticated Redis Exposed on LAN

**Severity:** CRITICAL  
**Impact:** Unauthorized access to Redis, potential data exposure

**Remediation:**
1. Enable Redis AUTH: Set `requirepass` in Redis config
2. Update connection strings: Add password to all Redis clients
3. Restrict network access: Bind to localhost or use firewall rules
4. Verify: Test Redis connection requires authentication

**Files to Update:**
- `workers/worker.js` (Redis connection)
- `control/dispatcher.js` (Redis connection)
- `ecosystem.config.js` (if Redis config there)
- Redis config file (typically `/etc/redis/redis.conf`)

### 3.2 C2: PostgreSQL Trust Authentication on LAN

**Severity:** CRITICAL  
**Impact:** Unauthorized database access without credentials

**Remediation:**
1. Update `pg_hba.conf`: Change `trust` to `md5` or `scram-sha-256`
2. Set strong passwords for all database users
3. Restrict network access: Only allow connections from trusted IPs
4. Verify: Test database connection requires password

**Files to Update:**
- PostgreSQL `pg_hba.conf` (typically `/etc/postgresql/*/main/pg_hba.conf`)
- Connection strings in all scripts using `DATABASE_URL`

### 3.3 C3: Discord Gateway Crash-Looping (75+ Restarts) But Reporting Healthy

**Severity:** CRITICAL  
**Impact:** Service instability, false health reports, potential data loss

**Remediation:**
1. Fix root cause: `DISCORD_BOT_TOKEN` loop issue (10+ reviews unfixed)
2. Implement proper error handling: Catch token errors, don't crash-loop
3. Fix health reporting: Ensure health checks reflect actual status
4. Add circuit breaker: Stop retrying after N failures
5. Verify: Monitor restart rate drops to <5/day

**Files to Review:**
- Gateway service (Discord bot code)
- Health check endpoints
- PM2 ecosystem config

**Additional Critical Issues (Lower Priority):**
- C4: Secret Scanning Pipeline Broken
- C5: Arbitrary Command Execution in Overnight Backup Scripts
- C6: PII Sent to Third-Party LLMs Without Redaction or DPAs
- C7: API Keys Logged to Monitoring Channels
- C8: Event Bus Audit Disabled in Production
- C9: 11 of 16 PM2 Cron Jobs Stopped Without Documentation
- C10: No Rate Limiting on Dispatcher
- C11: Trading Signals Lack Pre-Trade Risk Checks at DB Level

---

## 4. Worker Restart Rate (8/day vs <5/day Target)

### 4.1 Current State
- **Current:** 8 restarts/day
- **Target:** <5 restarts/day
- **Peak:** 21 restarts/day (improved from peak)
- **Total Cumulative:** 15,707+ restarts

### 4.2 Known Causes

**From Context:**
1. **Redis Connection Issues:** Connection refused errors
2. **Postgres Unreachable:** NAS power/network issues
3. **Missing Environment Variables:** `.env` missing required keys
4. **Memory Issues:** Potential memory leaks (check `process.memoryUsage()`)
5. **Dispatcher Pool Errors:** "Cannot use a pool af..." errors
6. **Ollama Port Conflict:** Port 11434 conflicts

### 4.3 Investigation Plan

1. **Check PM2 Logs:**
   ```bash
   pm2 logs claw-worker-llm --lines 100
   ```

2. **Monitor Memory Usage:**
   - Check `workers/worker.js` memory guard (line 40 in HEARTBEAT.md)
   - Verify `process.memoryUsage().rss < 500MB` threshold

3. **Check Connection Pooling:**
   - Review dispatcher pool errors
   - Verify connection pool limits
   - Check for connection leaks

4. **Verify Environment:**
   - Ensure all required env vars are set
   - Check Redis/Postgres connection strings

5. **Ollama Port Conflict:**
   - Verify Ollama is running on correct port
   - Check for multiple Ollama instances

### 4.4 Remediation Actions

1. **Add Connection Retry Logic:**
   - Exponential backoff for Redis/Postgres
   - Circuit breaker pattern

2. **Memory Leak Detection:**
   - Add memory profiling
   - Monitor heap usage over time

3. **Health Check Improvements:**
   - More comprehensive health checks
   - Better error reporting

---

## 5. Uptime Gap (88% vs 99.5% Target)

### 5.1 Current State
- **Current:** 88% uptime
- **Target:** 99.5% uptime
- **Gap:** 11.5 percentage points

### 5.2 Contributing Factors

1. **Worker Restarts:** 8/day contributes to downtime
2. **Gateway Crashes:** Discord gateway crash-looping
3. **Infrastructure Issues:** Redis/Postgres connection problems
4. **Ollama Conflicts:** Port conflicts causing service failures

### 5.3 Improvement Plan

1. **Reduce Worker Restarts:** (See Section 4)
   - Target: <5/day → should improve uptime by ~2-3%

2. **Fix Gateway Crashes:** (See Section 3.3)
   - Fix Discord token loop
   - Target: <1 restart/day → should improve uptime by ~3-4%

3. **Infrastructure Hardening:**
   - Improve Redis/Postgres connection resilience
   - Add automatic failover/recovery
   - Target: Reduce connection-related downtime by ~2-3%

4. **Monitoring & Alerting:**
   - Better uptime tracking
   - Faster incident response
   - Target: Reduce MTTR by 50%

**Expected Outcome:** 88% → 95%+ (approaching 99.5% target)

---

## 6. Implementation Priority

### Week 1 (Immediate)
1. ✅ **Schema Foreign Keys:** Migration 078 created, ready to apply
2. 🔴 **Security C1-C3:** Fix Redis auth, Postgres auth, Discord gateway
3. 🔍 **Worker Restarts:** Investigate root causes, add logging

### Week 2 (High Priority)
4. 📝 **Code Duplication:** Migrate ensureSchema() to migration checks
5. 🔧 **Worker Stability:** Implement fixes for identified restart causes
6. 📊 **Uptime Monitoring:** Improve tracking and alerting

### Week 3 (Ongoing)
7. 🔒 **Security C4-C11:** Address remaining critical security issues
8. 📈 **Uptime Improvement:** Target 95%+ uptime
9. ✅ **Verification:** Verify all fixes are working in production

---

## 7. Success Metrics

### Schema Integrity
- [ ] All foreign key constraints applied
- [ ] No orphaned data in tables
- [ ] bot_conversion_events table exists
- [ ] All ensureSchema() functions replaced with migration checks

### Security
- [ ] Redis requires authentication
- [ ] Postgres requires authentication
- [ ] Discord gateway stable (<1 restart/day)
- [ ] Critical security findings reduced from 3+ to <3

### Worker Stability
- [ ] Restart rate <5/day (currently 8/day)
- [ ] No memory leaks detected
- [ ] Connection pool errors resolved
- [ ] Ollama port conflicts resolved

### Uptime
- [ ] Uptime >95% (currently 88%)
- [ ] Target: 99.5% uptime
- [ ] MTTR <15 minutes

---

## 8. Notes

- **Measurement Methodology:** Need to reconcile measurement conflicts (see STRATEGY.md)
- **Mission Control:** Still dark for 28+ days - separate issue
- **Revenue Scaling:** $0 MRR → $2,000+ target (Stripe live; business priority is first customers, not technical)

---

**Last Updated:** 2026-03-01  
**Next Review:** 2026-03-08
