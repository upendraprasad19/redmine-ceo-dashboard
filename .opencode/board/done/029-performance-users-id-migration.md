# 029 — Switch performance_snapshots.user_id from dashboard_users(id) to users(id)

**Status:** done
**Tier:** T2
**Date:** 2026-07-30

## What
PM Pulse profile modal showed all 0s/dash for every user because `performance_snapshots.user_id` referenced `dashboard_users(id)`, but most team members (developers, QA) don't have `dashboard_users` entries. The performance cron only scored users with `dashboard_users` rows — which was nobody useful.

## Root Cause
Two-table architecture: `users` (Redmine-synced, all staff) vs `dashboard_users` (dashboard logins, managers/TLs only). Performance scoring iterated `dashboard_users` → 0 users scored. Profile API resolved `users.id` → `dashboard_users.id` → null → returned `performance: null`.

## Changes
1. **Migration 024** — `scripts/migrations/024-performance-use-users-id.sql`: Drop FK on `performance_snapshots.user_id`, add FK to `users(id)`, backfill via `linked_redmine_user_id`
2. **`intelligence/performance.js`** — Query `users` table (not `dashboard_users`), use `user.id` directly
3. **`pages/api/people/[id]/profile.js`** — Performance query unconditional (no `dashboard_users` gate), team avg JOIN fixed
4. **`intelligence/matcher.js`** — Performance query uses `uid` (was `dev.dashboard_user_id`)
5. **`tests/unit/people-profile-api.test.js`** — Updated test: performance now returns data without `dashboard_users` link

## Files touched
- `scripts/migrations/024-performance-use-users-id.sql` (new)
- `intelligence/performance.js`
- `pages/api/people/[id]/profile.js`
- `intelligence/matcher.js`
- `tests/unit/people-profile-api.test.js`

## Verification
- [x] `npm run test:unit` — 146 tests pass
- [x] `npm run build` — succeeds

## Known Issue (not fixed)
`lib/gpt-executor.js:398-402` queries `capacity_status WHERE user_id = ${person.id}` but `capacity_status.user_id` references `dashboard_users.id`. Pre-existing bug. Separate concern (10+ consumer files).

## Completion
**Done:** 2026-07-30
