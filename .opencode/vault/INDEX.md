# Memory Vault — Redmine CEO Dashboard

## Patterns
- [[sync-pattern]] — Sync pipeline entity-resolution + upsert pattern  
- [[sortable-table-columns]] — Table column sorting with scope toggle
- [[naming-conventions]] — Comprehensive naming conventions across codebase  
- [[weekly-reconcile]] — Weekly per-project full scan to fix delta sync drift
- [[approved-project-filter]] — Approved-project filter required on every query reading issues/time_entries
- [[people-screen-architecture]] — People screen data flow, API overlap, and data freshness
- [[sync-initial-is-dead-code]] — sync-initial.js is obsolete, superseded by sync-redmine --full + sync-backfill
- [[shared-component-extension]] — Never add screen-specific props to shared components; render as children instead
- [[unit-test-pure-logic]] — How to test pure-logic lib/ modules (no DB, no network)
- [[unit-test-network-mocking]] — How to test fetch-calling lib/ modules with vi.stubGlobal
- [[rationalization-defense]] — Defense tables against excuse-generation for "Don't" rules
- [[dual-auth-api]] — Dual-auth pattern: server secret header OR session cookie for API routes
- [[github-actions-cron-dispatch]] — Move hourly crons from Vercel Hobby to GitHub Actions
- [[constants-extraction-pattern]] — Extract duplicated constants to lib/constants.js as single source of truth
- [[sentinel-iso-parsing]] — Parse sentinel file ISO content instead of using filesystem mtime

## Gotchas
- [[opencode-gitignore-force-add]] — .opencode/ is gitignored; need git add -f for tracked files
- [[gate-self-referential-doc]] — Gates that ban words catch their own documentation
- [[delivery-owner-enum-vs-userid]] — Delivery Owner is an ENUM field, not a User field
- [[hardcoded-redmine-url]] — Hardcoded wrong Redmine URL in ticket links
- [[sync-status-map-duplication]] — Status map duplicated in 4 files, can drift apart
- [[scroll-jump-from-global-sort]] — Shared sort state across accordions triggers scroll anchoring
- [[default-sort-indicator-mismatch]] — Default client-side sort must update header indicator to match
- [[retro-enforcement]] — Shared helper for retro trigger checks (board.js + idle-nudge.js)
- [[people-screen-metrics-limitations]] — No derived performance metric, hardcoded capacity, redundant computation
- [[non-engineering-and-unassigned-users]] — 22 users without team + 8 in non-engineering teams hidden from screen
- [[union-vs-union-all-count]] — UNION deduplicates SELECT 1 rows, making COUNT(*) always return 1
- [[cjs-mocking-in-vitest]] — CJS require() mocking fails when env vars not set before module load
- [[health-check-broken-column-ref]] — health-check.js used wrong column name redmine_project_id vs redmine_id
- [[orphan-tables-confirmed]] — 9 orphan tables confirmed safe to drop; password_reset_tokens is NOT orphan
- [[unhandled-async-before-trycatch]] — Unhandled async error before try/catch returns HTML 500, breaks client JSON parsing
- [[discipline-protocol-not-followed]] — Task-focused mindset overrides protocol; need visible checklist in every session

## Tags
- See `tags/INDEX.md` for tag index.

## Security Patterns (Jul 2026 audit)
- [[api-error-sanitization]] — All API routes use send500() to avoid leaking err.message
- [[rate-limiting-sliding-window]] — Upstash Redis sliding window rate limiter for sensitive endpoints
- [[fail-open-rate-limit]] — Rate limiting must fail-open (never block auth) when Redis is down
- [[rate-limit-nested-trycatch]] — Rate limit checks must have own nested try/catch for fail-open

## Protocol
- After every `done` task, run `skill self-learning` to extract new patterns/gotchas
- Cross-reference existing entries to avoid duplicates
- New entries use `templates/memory-note.md`

## Process (Jul 2026)
- [[discipline-gates]] — Pre-commit/pre-push gate system (deferral gate, blast-radius, audit closure, plan-review records)

## Audit Patterns (Jul 2026 audit)
- [[audit-infrastructure]] — docs/audit/ with AUDIT_PLAYBOOK.md, LENS_REGISTRY.md, SoT schema, closure templates
- [[audit-gate-scripts]] — 10 automated gate scripts enforced via npm run audit:gates
- [[audit-sot-registry]] — SoT YAML registry for 8 core tables with writer/reader contracts
- [[audit-lenses-14]] — 14 canonical audit lenses covering Security, Data Integrity, Code Quality, Tests, Infrastructure
- [[no-deferral-audit-closures]] — Every finding must reach terminal state, no deferrals allowed
- [[audit-severity-framework]] — P0-P3 severity classification with clear action thresholds
- [[sot-writer-reader-contract]] — SoT YAML documents writer/reader contracts per table
- [[lens-based-audit-execution]] — Decompose audit into 14 canonical lenses with checklists
- [[gate-scripts-as-static-analysis]] — 10 gate scripts as lightweight static analysis layer

## Audit Gotchas (Jul 2026 audit)
- [[slack-tdz-bug]] — Slack events.js TDZ bug bypasses signature verification (AUD-001)
- [[missing-normalize-email-sync]] — pages/api/sync.js missing normalizeEmail() call (AUD-002)
- [[no-trycatch-auth-endpoints]] — 6 auth endpoints missing try/catch (AUD-003)
- [[no-e2e-tests]] — tests/e2e/ directory empty despite Playwright installed (AUD-004)
- [[morning-briefing-no-whitelist]] — Morning briefing "no time log" count missing engineering whitelist (AUD-005)
- [[constant-drift-12-files]] — APPROVED_PROJECT_IDS duplicated in 12 files, gate only checks 4 (AUD-009/020)
- [[status-priority-map-drift]] — statusMap and priorityMap duplicated in 4 files each (AUD-006/007)
- [[send500-bypass-6-routes]] — 6 API routes use inline res.status(500) instead of send500 (AUD-010)
- [[cjs-in-esm-pages]] — 22 pages/api/ files use CJS require instead of ESM import (AUD-023)
- [[check-module-system-regex-bug]] — check-module-system.js regex logic error may miss violations (AUD-025)
- [[password-reset-rate-limit-gap]] — Forgot-password flow has no rate limiting (AUD-011)
- [[username-enumeration-via-response-shape]] — forgot-password channels leaks user existence (AUD-018)
- [[schema-contract-stale-after-migration]] — Schema contract has tables that migration 023 drops (AUD-027)
- [[gate-script-coverage-gap]] — Gate scripts can have coverage gaps (AUD-020)
- [[latent-sql-interpolation-in-unused-variable]] — Dead code with SQL injection risk (AUD-028)
- [[err-message-leak-in-cron-batch-response]] — err.message exposed in cron batch response (AUD-015)

## Audit Optimizations (Jul 2026 audit)
- [[audit-cadence-structure]] — Three audit cadences: per-batch, quarterly, pre-deploy
- [[audit-findings-to-vault-auto-crossref]] — Findings cross-reference vault entries, creating closed loop
- [[sot-registry-auto-generation]] — SoT registry auto-generated from codebase analysis
