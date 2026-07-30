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

## Enforcement plugin (Task 032 — machine-enforced gates)
Two architectural layers: advisory (hooks.yaml) + enforcement (plugin).

### Gate 1: Session-start gate (blocking)
- **Hook:** `tool.execute.before`
- **Blocks:** edit, write, bash
- **Condition:** `.opencode/.bootstrap-done` sentinel missing or >24h stale
- **Exception:** bash commands containing "bootstrap" pass through
- **Sentinel:** Written by `scripts/session-bootstrap.js` on success with ISO timestamp

### Gate 2: Plan-first gate (blocking)
- **Hook:** `tool.execute.before`
- **Blocks:** edit, write on code files (.js, .ts, .jsx, .tsx in pages/, lib/, components/, scripts/, bots/, crons/, tests/)
- **T0 exceptions:** .env, .md, .json, .yml, .yaml always allowed
- **Task file exceptions:** .opencode/board/active/*.md always allowed
- **Condition:** board/active/ empty OR no active task has ## Plan/## What/## Files section

### Gate 3: Post-edit test reminder (non-blocking)
- **Hook:** `file.changed` in hooks.yaml
- **Fires:** on any .js/.ts/.jsx/.tsx file change
- **Action:** prints "Run `npm run test:unit` after edits"

### Gate 4: Self-learning reminder (non-blocking)
- **Hook:** `session.idle` in hooks.yaml
- **Fires:** if board/done/ changed in recent commits
- **Action:** prints "Run `skill self-learning` after task completion"

### Audit logging
- Blocked actions logged to `.opencode/.blocked-actions.log`
- Format: `ISO timestamp | gate | tool | target`

### Error handling
- All gates use try/catch with fail-open semantics
- Gate errors logged to stderr, tool execution continues
