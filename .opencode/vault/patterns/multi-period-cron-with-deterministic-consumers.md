# Multi-period cron with deterministic consumer routing

**Type:** pattern
**Date:** 2026-07-30
**Related:** [[performance-snapshots-fk-wrong-table]], [[sync-pattern]]
**Tags:** #performance #cron #period #determinism

## What
When a cron stores data for multiple time periods (daily/weekly/monthly), consumers that don't need period-specific data must explicitly pin to one period to avoid non-deterministic results.

## Pattern
1. **Cron** generates all period variants in one run:
```js
for (const period of ['daily', 'weekly', 'monthly']) {
  await calculatePerformanceScores(period)
}
```
2. **Period-aware consumers** (profile API, UI) query `WHERE period = ${period}` — works as-is.
3. **Period-agnostic consumers** (matcher, AI context) must add `AND period = 'daily'` to avoid non-deterministic `ORDER BY snapshot_date DESC LIMIT 1` when multiple rows share the same date.

## Why this works
- Cron stores 3 rows per user per day (one per period)
- `DISTINCT ON (u.id) ORDER BY snapshot_date DESC` is non-deterministic when 3 rows share the same date
- Pinning to `daily` preserves the original deterministic behavior
- Rolling 7d/30d scores are only meaningful for UI display, not for ML/AI context

## Anti-pattern
Don't force all consumers to `daily` — period-aware consumers (profile modal) need weekly/monthly data. The key is **routing by consumer intent**, not blanket forcing.
