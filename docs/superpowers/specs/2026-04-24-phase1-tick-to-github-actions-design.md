# Phase1-Tick: Move from Vercel Cron to GitHub Actions

## Context

Production deploys on Vercel have been blocked since commit `7de435f` ("feat(cron): phase1-tick dispatcher running every 15 min") was merged. Vercel's Hobby plan rejects any cron expression that runs more than once per day, and the `*/15 * * * *` schedule on `/api/cron/phase1-tick` fails the plan validator with:

> "Hobby accounts are limited to daily cron jobs."

As a result, five commits on `master` (including an unrelated time-screen fix committed as `7545908`) are sitting on GitHub without reaching production.

The repo already uses the "move high-frequency cron off Vercel" pattern once: commit `09d702a` removed `/api/cron/reminder-delivery` from `vercel.json` for the same reason.

phase1-tick cannot simply be dropped or reduced to daily — it drives three features:

- **Intimation follow-up:** nudges unanswered Telegram threads at 4h, closes at 24h.
- **Commitment follow-up:** DMs developers when a promise's `due_at` passes.
- **Chat enrichment:** enriches chat history in batches of 50.

The 4h/24h windows require at least hourly tick resolution to avoid eye-watering delays.

## Goal

Unblock Vercel production deploys while preserving the 15-minute cadence for phase1-tick, without adding a new paid service or dependency.

## Approach

Use **GitHub Actions** as the external scheduler. The workflow `curl`s the existing `/api/cron/phase1-tick` endpoint every 15 minutes, authenticated with the same `CRON_SECRET` that Vercel Cron was using.

- No change to the endpoint handler at `pages/api/cron/phase1-tick.js`.
- `vercel.json` loses the phase1-tick entry; the other five crons are unaffected.
- GitHub Actions is free for public or private repos within quota; scheduled runs count toward free minutes (≈0.5 min × 96 runs/day ≈ 48 min/day, well under the 2,000 min/month free allowance for private repos).

## Changes

### New file — `.github/workflows/phase1-tick.yml`

Scheduled workflow with `workflow_dispatch` fallback for manual runs. Uses `curl --fail` so non-200 responses fail the run. Single-step job; no setup overhead.

```yaml
name: phase1-tick
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch: {}
concurrency:
  group: phase1-tick
  cancel-in-progress: false
jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Trigger phase1-tick
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl --fail --silent --show-error \
            -H "x-cron-secret: $CRON_SECRET" \
            "https://thinking-code-delivery-ai.vercel.app/api/cron/phase1-tick"
```

Notes:
- `concurrency` group prevents overlapping runs if one is slow.
- `timeout-minutes: 5` bounds cost in case the endpoint hangs.
- Hardcoded production URL is intentional: this cron only targets prod, not previews.

### Modify — `vercel.json`

Delete the phase1-tick block:

```json
{
  "path": "/api/cron/phase1-tick",
  "schedule": "*/15 * * * *"
}
```

### One-time manual setup (outside Claude's scope)

Add `CRON_SECRET` to GitHub repo secrets, value identical to Vercel's `CRON_SECRET` env var.

Via CLI:
```
gh secret set CRON_SECRET --repo upendraprasad19/redmine-ceo-dashboard
```

Or via UI: Settings → Secrets and variables → Actions → New repository secret.

## Caveats

**GitHub Actions scheduled triggers can be delayed.** Under platform load, a `*/15` workflow may fire 5–30 minutes later than scheduled. For the 4h/24h intimation windows this is acceptable; nudges shift by tens of minutes at worst, not hours.

**If the endpoint itself breaks,** GitHub will email on repeated failures (default notification setting). No extra alerting is added — if we need Slack/Telegram alerts later, add them then.

## Verification

1. After merge + secret setup, manually trigger:
   ```
   gh workflow run phase1-tick.yml
   ```
   Confirm run is green in Actions tab and endpoint returns `{ ok: true, results: {...} }`.
2. Wait for two scheduled runs (~30 min) to confirm the schedule fires.
3. Retry Vercel production deploy — should no longer hit the cron validator.
4. Confirm live prod has the time/overview fix from commit `7545908` (new "Yesterday" card on Time screen, Today's Hours on Overview).

## Out of Scope

- Other Vercel crons (sync, morning-briefing, missing-log-reminder, friday-summary, learning-layer) — all daily or less, Hobby-compatible, no changes.
- The phase1-tick endpoint handler itself — unchanged.
- Alternative schedulers (cron-job.org, Upstash, etc.) — not needed since GitHub Actions suffices.
- Refactoring the three underlying jobs (intimation/commitment/enrichment) — separate concern.
