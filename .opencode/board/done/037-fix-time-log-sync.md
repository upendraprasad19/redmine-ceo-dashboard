# 037 — Fix time log sync: widen buffer, move daily sync to GitHub Actions, fix profile lookback, backfill missing entries

**Status:** done
**Date:** 2026-07-31

## What
Production sync uses 1-day buffer for time entries. Backdated entries (logged late with older `spent_on`) fall outside window and are permanently missed. Runs on Vercel Hobby (10s timeout) which caps buffer width. Also, person profile query only looks back 7 days for `last_log_date`, showing NULL for entries 8-30 days old.

## Changes
1. **New file** `.github/workflows/redmine-sync.yml` — daily sync via GitHub Actions (no timeout), with `--full` input for manual backfill, plus weekly-reconcile step
2. **Edit** `vercel.json` — remove `/api/sync` cron entry (`"crons": []`)
3. **Edit** `pages/api/sync.js:128-140,239-240` — add `timeEntriesSince` with 7-day buffer for time entries (button path)
4. **Edit** `pages/api/people/[id]/profile.js:176-182` — expand to 30-day window + CASE split for `hours_last_7days`
5. **One-time backfill** — `node scripts/sync-redmine.js --full`

## Verification
- [ ] `npm run test:unit` passes
- [ ] `npm run audit:gates` passes (check-approved-projects-sync checks sync.js)
- [ ] `vercel.json` is valid JSON with empty crons
- [ ] GitHub Actions workflow syntax valid
- [ ] Local backfill completes without error

## Files touched
- `.github/workflows/redmine-sync.yml` (new)
- `vercel.json`
- `pages/api/sync.js`
- `pages/api/people/[id]/profile.js`

## Completion
**Done:** 2026-07-31

Fix time log sync: widen time-entry buffer to 7d in sync.js, move daily sync to GitHub Actions (no timeout), expand profile lookback to 30d, remove Vercel cron, add --full workflow_dispatch input
