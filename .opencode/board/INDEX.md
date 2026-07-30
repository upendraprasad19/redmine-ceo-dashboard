# Task Board — Redmine CEO Dashboard

## Active
- [aud-029-unit-tests](active/033-aud-029-unit-tests.md) — Add unit tests for 8 lib/ modules: db, admin, redis, rate-limit, table-audit, gpt-executor, ai, chat-enrichment

## Backlog
_No backlog tasks._

## Done
- [fix-sync-endpoint](done/001-fix-sync-endpoint.md) — Fix `pages/api/sync.js` — Delivery Owner mapping, project filtering, issue_team_history
- [backfill-delivery-owners](done/002-backfill-delivery-owners.md) — Backfill Delivery Owner mapping for 6,769 issues
- [sortable-ticket-columns](done/003-sortable-ticket-columns.md) — Add sortable ticket columns (Created date, Due Date)
- [fix-jwt-secret](done/004-fix-jwt-secret.md) — Add missing JWT_SECRET to .env.local
- [fix-redmine-url](done/005-fix-redmine-url.md) — Fix hardcoded redmine.redmind.com → redmine.thinkingcode.com
- [sync-status-mapping-and-robustness](done/006-sync-status-mapping-and-robustness.md) — sync-status-mapping-and-robustness
- [fix-project-ordering](done/007-fix-project-ordering.md) — fix-project-ordering-in-tickets-view
- [per-accordion-sort](done/008-per-accordion-sort.md) — per-accordion-sort
- [discipline-protocol-improvements](done/009-discipline-protocol-improvements.md) — Discipline protocol improvements
- [people-screen-health-scoring](done/010-people-screen-health-scoring.md) — People Screen: Health Scoring, Fixes & Consolidation
- [people-sheet-layout-redesign](done/011-people-sheet-layout-redesign.md) — People Sheet Layout Redesign
- [security-audit-batch1-3](done/013-security-audit-batch1-3.md) — Security Audit Remediation (Batches 1–3)
- [discipline-gaps](done/014-discipline-gaps.md) — Fix 4 discipline automation gaps
- [fix-login-network-error](done/015-fix-login-network-error.md) — Fix login 'Network error' when Redis is down - fail-open rate limiting + honest error message
- [cron-consolidation](done/016-cron-consolidation.md) — Consolidate 6 Vercel crons into 2 (sync + batch), fix broken auth on 5 standalone endpoints, schedule 13 orphaned crons/index.js jobs, refactor tgSend to lib/telegram.js, delete redundant phase1-tick.js
- [enriched-person-modal](done/017-enriched-person-modal.md) — Enriched Person Modal: Performance review popup with scores, velocity, workload, time logs, commitments
- [fix-sync-auth-for-dashboard](done/018-fix-sync-auth-for-dashboard.md) — Fix /api/sync to accept session-cookie auth so dashboard Refresh Data button works without CRON_SECRET header
- [vercel-hobby-cron-fix](done/019-vercel-hobby-cron-fix.md) — Move hourly batch cron from Vercel (Hobby-rejected) to GitHub Actions
- [audit-infrastructure](done/020-audit-infrastructure.md) — Create docs/audit/ with AUDIT_PLAYBOOK.md, LENS_REGISTRY.md, SoT schema, closure templates
- [audit-gate-scripts](done/021-audit-gate-scripts.md) — Create 10 automated gate check scripts + npm audit:gates + audit-gates.sh wrapper
- [audit-sot-registry](done/022-audit-sot-registry.md) — Create SoT YAML registry for 8 core tables with writer/reader contracts
- [audit-full-execution](done/023-audit-full-execution.md) — Execute full 14-lens audit, document findings with severity P0-P3
- [audit-closures](done/024-audit-closures.md) — Create audit closures YAML with terminal states (no deferrals)
- [discipline-tier1-tier2](done/025-discipline-tier1-tier2.md) — Discipline improvements: deferral gate, blast-radius, audit closure, review records, session injection
- [default-tickets-sort](done/026-default-tickets-sort.md) — Default sort tickets by created date descending (latest first)
- [audit-fix-execution](done/027-audit-fix-execution.md) — Execute audit fix plan: P0+P1+P2 fixes across 23 files
- [rate-limiting-batch-d](done/028-rate-limiting-batch-d.md) — Add rate limiting to password reset, chat, and sync endpoints (AUD-011/012/013)
- [performance-users-id-migration](done/029-performance-users-id-migration.md) — Switch performance_snapshots.user_id from dashboard_users(id) to users(id)
- [board-utils-sentinel-fix](done/030-board-utils-sentinel-fix.md) — Fix board-utils sentinel parsing to use ISO content instead of mtime, fix flaky tests
- [retro-trigger-enforcement](done/031-retro-trigger-enforcement.md) — Add retro check to board.js done, new retro/retro-mark commands, shared board-utils.js helper
- [discipline-enforcement-plugin](done/032-discipline-enforcement-plugin.md) — Machine-enforced discipline gates via opencode plugin (session-start gate, plan-first gate, post-edit test gate, auto self-learning, compliance report)
- [performance-periods](done/034-performance-periods.md) — Fix PM Pulse weekly/monthly views — cron now stores all 3 periods, fix matcher + gpt-executor to use daily for deterministic scoring

## Board protocol
- **Creating a task**: `node scripts/board.js create "slug" "Description"`
- **Starting a task**: `node scripts/board.js start NNN`
- **Done**: `node scripts/board.js done NNN "Summary"`
- **Validate**: `node scripts/board.js validate`
- **Sync INDEX.md**: `node scripts/board.js sync`
- **Retro**: `node scripts/board.js retro` / `retro-mark`
