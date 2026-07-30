# performance_snapshots FK pointed at wrong table

**Type:** gotcha
**Date:** 2026-07-30
**Related:** [[people-screen-architecture]], [[delivery-owner-enum-vs-userid]]
**Tags:** #performance #schema #fk #dashboard-users

## What
`performance_snapshots.user_id` had FK to `dashboard_users(id)`, but the performance cron iterates `users` (all Redmine staff). Most team members (developers, QA) don't have `dashboard_users` entries (only managers, TLs, and intimation-relay developers do). Result: cron scored 0 users, profile modal showed all 0s/dash.

## How it was discovered
User reported PM Pulse profile showing "0" for Output, Speed, Quality, Reliability, Collaboration and "-" for Score, Avg Resolution, Reopen Rate, Deadline Hit, Commitments. Velocity chart worked (queries `issues` directly).

## The two-table trap
Codebase has two user tables:
- `users` — synced from Redmine, all staff. `users.id` is the Neon PK.
- `dashboard_users` — dashboard logins only (managers, TLs, developers with bot access). Has `linked_redmine_user_id` FK to `users.id`.

Many queries need to work for ALL users, not just dashboard users. When FK references `dashboard_users(id)`, non-dashboard users are invisible.

## Fix
Migration 024 switched `performance_snapshots.user_id` FK from `dashboard_users(id)` → `users(id)`. Scoring engine now iterates `users` table directly.

## Prevention
When adding a new table with `user_id` FK, ask: "Does this need to cover ALL Redmine users, or only dashboard users?" If all users, FK should reference `users(id)`.

## Related tables
| Table | FK references | Covers all users? |
|-------|--------------|-------------------|
| `performance_snapshots.user_id` | `users(id)` | ✅ (fixed) |
| `capacity_status.user_id` | `dashboard_users(id)` | ❌ |
| `commitments.user_id` | `dashboard_users(id)` | ❌ |
| `bot_threads.originator_id` | `dashboard_users(id)` | ❌ |
| `bot_threads.target_id` | `dashboard_users(id)` | ❌ |
