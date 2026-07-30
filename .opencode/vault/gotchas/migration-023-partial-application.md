# Migration 023 was partially applied

**Date:** 2026-07-39
**Tags:** [migration, gotcha, schema]

When running `node scripts/generate-schema-contract.js`, 4 of 9 tables from migration 023 still existed in the DB despite the migration file being present. The migration had been applied to 5 tables but not the other 4.

## Resolution
- Ran `DROP TABLE IF EXISTS` for the 4 remaining tables (`anomaly_alerts`, `daily_snapshots`, `register_rate_limit`, `telegram_sessions`)
- Regenerated contract — now 36 tables (correct)

## Lesson
Migrations can be partially applied if previous runs failed mid-execution. Always verify by querying `information_schema.tables` after applying, or check the contract output for orphaned tables.
