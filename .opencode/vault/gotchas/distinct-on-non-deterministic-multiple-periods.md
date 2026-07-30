# DISTINCT ON non-deterministic with multiple snapshot periods

**Type:** gotcha
**Date:** 2026-07-30
**Related:** [[multi-period-cron-with-deterministic-consumers]], [[performance-snapshots-fk-wrong-table]]
**Tags:** #performance #sql #distinct-on #non-deterministic

## What
`DISTINCT ON (u.id) ORDER BY u.id, ps.snapshot_date DESC` returns an arbitrary row when multiple rows share the same `snapshot_date` (e.g., daily/weekly/monthly snapshots all created on the same cron run day).

## Affected queries
- `lib/gpt-executor.js:703-716` — Team/all performance report (DISTINCT ON)
- `lib/gpt-executor.js:668-677` — Per-person 'latest' report (ORDER BY + LIMIT 1)
- `intelligence/matcher.js:87-93` — Performance factor scoring (ORDER BY + LIMIT 1)

## How it manifests
After adding weekly/monthly snapshots, these queries may return a weekly or monthly score where a daily score was intended. The matcher would oscillate between recommendations on the same data because weekly scores differ from daily scores.

## Fix
Add `AND period = 'daily'` (or appropriate period) to the WHERE clause before the ORDER BY.

## Detection
Any query on `performance_snapshots` using `ORDER BY snapshot_date DESC LIMIT 1` or `DISTINCT ON` without a period filter is vulnerable after multi-period storage is enabled.
