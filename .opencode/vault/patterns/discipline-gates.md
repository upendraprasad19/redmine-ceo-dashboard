# Discipline gates

Added in Task 020. Inspired by AVYA's 72+ pre-commit gate system.

## Pre-commit gates (current order)
1. `lint-staged` — Biome auto-fix
2. `gitleaks protect --staged` — secret detection
3. `board.js validate --warn` — INDEX.md sync check
4. `check-drift.js --warn` — DB schema drift (conditional, sync-related files only)
5. `check-no-deferral.js` — deferral-euphemism detection in staged .md files
6. `validate-audit-closure.js --warn` — audit closure ledger validation

## Pre-push gates (blast-radius tiered)
1. `blast-radius.js` — classify push as `feature` or `account`
2. If `feature` (docs-only): skip local gates, CI is backstop
3. If `account` (code): run tests + board validate + build + review-diff

## Session-start injection
- `discipline-reminder.js` — prints active/backlog counts, days since last commit, vault staleness, gate summary

## Plan-review records
- `board.js done` now warns if `docs/reviews/<NNN>-<slug>.md` is missing
- Advisory only (non-blocking)
