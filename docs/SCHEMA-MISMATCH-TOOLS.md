# Schema Mismatch Tools

This document describes the schema mismatch and audit tooling in claw-architect. Use these to detect drift between **migrations**, **database**, and **code** so you can fix mismatches before they cause runtime failures.

---

## Overview

| Tool | Script | Purpose |
|------|--------|---------|
| **Schema mismatch audit** | `scripts/schema-mismatch-audit.js` | Fast DB check: migrations vs applied, required tables/columns, status enums, invalid constraints/indexes. |
| **Schema audit comprehensive** | `scripts/schema-audit-comprehensive.js` | Deeper audit: code references to tables/columns vs actual DB, migration coverage, missing indexes, foreign keys, column mismatches. |

Both tools require **database access** (Postgres). Set `CLAW_DB_*` or `POSTGRES_*` env vars. If run in a sandboxed environment without network access to the DB, they will fail; run from a host/shell that can reach the database.

---

## 1. Schema mismatch audit (fast)

**What it checks**

- **Migrations:** Migration files under `migrations/*.sql` vs applied versions in `schema_migrations`. Fails if there are pending migrations or duplicate version numbers.
- **Required tables/columns:** Ensures expected tables exist and have required columns (e.g. `tasks`: id, type, payload, status, worker_queue, required_tags, idempotency_key; loyalty/credit tables).
- **Integrity:** Invalid constraints and invalid indexes in Postgres.
- **Status enums:** CHECK constraints on status-like columns contain expected values (e.g. `tasks.status` includes CREATED, RUNNING, COMPLETED, FAILED, DEAD_LETTER, CANCELLED).

**Commands**

```bash
# Human-readable report (default)
npm run schema:audit

# JSON output for automation (e.g. system-4h-checkfix, task-governor)
npm run schema:audit:json

# Fail on warnings as well as failures
node scripts/schema-mismatch-audit.js --strict
```

**Exit codes**

- `0`: No failures (and no warnings when not `--strict`).
- `1`: One or more failures, or any warning when `--strict` is used.

**Output (default)**

- `ok: YES | NO`
- Counts: migration files, versions in files vs applied, pending versions, invalid constraints/indexes.
- **FAILURES:** e.g. `PENDING_MIGRATIONS`, `MISSING_TABLE`, `MISSING_COLUMNS`, `INVALID_CONSTRAINTS`, `STATUS_CHECK_MISMATCH`.
- **WARNINGS:** e.g. `DUPLICATE_MIGRATION_VERSIONS`, `APPLIED_VERSIONS_WITHOUT_FILE`.

**When to run**

- Before deploying or after adding migrations: `npm run schema:audit`.
- In CI or 4h-checkfix: `npm run schema:audit:json` and parse `ok` and `failures`.

---

## 2. Schema audit comprehensive (code vs DB)

**What it checks**

1. **Code → DB:** Tables referenced in code (FROM, INTO, UPDATE, JOIN, CREATE TABLE in `**/*.js`, `**/*.ts`) but missing in the database.
2. **DB → migrations:** Tables present in DB but not declared in any migration file.
3. **Missing indexes:** Common query columns (id, created_at, status, etc.) used in SELECTs but not indexed.
4. **Foreign keys:** FK constraints referencing non-existent tables.
5. **Column mismatches:** Columns referenced in code but missing in the database (per table).

**Command**

```bash
npm run schema:audit:comprehensive
```

**Output**

- Console: step-by-step progress and list of issues (missing tables, no migration, missing index, broken FK, missing column).
- **Report file:** `schema-audit-report.json` in the project root (detailed issues array). Move or symlink to `reports/` if you want it alongside other reports.

**Issue types**

| Type | Severity | Meaning |
|------|----------|--------|
| `missing_table` | high | Code references a table that does not exist in DB. |
| `missing_column` | high | Code references a column that does not exist on the table. |
| `broken_foreign_key` | high | FK references a non-existent table. |
| `no_migration` | medium | Table exists in DB but has no migration file. |
| `missing_index` | medium | Frequently queried column has no index. |

**When to run**

- After large refactors or when adding new tables/columns in code.
- Periodically (e.g. weekly or before release) to catch code/DB drift.

---

## Environment

Both tools use the same DB connection settings:

- `CLAW_DB_HOST` or `POSTGRES_HOST`
- `CLAW_DB_PORT` or `POSTGRES_PORT` (default 15432)
- `CLAW_DB_USER` or `POSTGRES_USER` (default claw)
- `CLAW_DB_PASSWORD` or `POSTGRES_PASSWORD`
- `CLAW_DB_NAME` or `POSTGRES_DB` (default claw_architect)

Ensure the database is reachable from the environment where you run the scripts (see MEMORY.md note on sandboxed environments).

---

## Integration

- **system-4h-checkfix:** Runs `npm run schema:audit:json` and records result in the checkfix report.
- **Task governor / health:** Uses schema audit JSON for schema health.
- **Deep audit:** May run schema checks as part of a broader audit; see `scripts/audit-deep.js` and related docs.

---

## Adding or changing required tables/columns

**schema-mismatch-audit:** Edit `REQUIRED_TABLE_COLUMNS` and `STATUS_ENUM_EXPECTATIONS` in `scripts/schema-mismatch-audit.js` when you add new core tables or status columns that must always be present and consistent.

**schema-audit-comprehensive:** The code extracts table/column references by scanning SQL patterns in `.js`/`.ts`; no manual table list. To tighten index suggestions, adjust the “frequently queried” column list in the missing-index check (e.g. `shouldBeIndexed`).

---

## Quick reference

| Goal | Command |
|------|--------|
| Quick DB vs migrations + required columns | `npm run schema:audit` |
| JSON for automation | `npm run schema:audit:json` |
| Strict (fail on warnings) | `node scripts/schema-mismatch-audit.js --strict` |
| Code vs DB + migrations + indexes + FKs | `npm run schema:audit:comprehensive` |
