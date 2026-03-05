# schema_integrity_agent MEMORY

- role: Schema Integrity Agent
- job: Verify migration 078 applied, check bot_conversion_events table, audit ensureSchema() functions, replace with migration checks, report missing foreign keys.
- command: npm run -s status:review:schema
- cron: 0 */2 * * *
