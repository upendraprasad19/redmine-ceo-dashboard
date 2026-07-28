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

## Gotchas
- [[delivery-owner-enum-vs-userid]] — Delivery Owner is an ENUM field, not a User field
- [[hardcoded-redmine-url]] — Hardcoded wrong Redmine URL in ticket links
- [[sync-status-map-duplication]] — Status map duplicated in 4 files, can drift apart
- [[scroll-jump-from-global-sort]] — Shared sort state across accordions triggers scroll anchoring
- [[people-screen-metrics-limitations]] — No derived performance metric, hardcoded capacity, redundant computation
- [[non-engineering-and-unassigned-users]] — 22 users without team + 8 in non-engineering teams hidden from screen
- [[union-vs-union-all-count]] — UNION deduplicates SELECT 1 rows, making COUNT(*) always return 1
- [[cjs-mocking-in-vitest]] — CJS require() mocking fails when env vars not set before module load
- [[health-check-broken-column-ref]] — health-check.js used wrong column name redmine_project_id vs redmine_id
- [[orphan-tables-confirmed]] — 9 orphan tables confirmed safe to drop; password_reset_tokens is NOT orphan
- [[unhandled-async-before-trycatch]] — Unhandled async error before try/catch returns HTML 500, breaks client JSON parsing

## Tags
- See `tags/INDEX.md` for tag index.

## Security Patterns (Jul 2026 audit)
- [[api-error-sanitization]] — All API routes use send500() to avoid leaking err.message
- [[rate-limiting-sliding-window]] — Upstash Redis sliding window rate limiter for sensitive endpoints
- [[fail-open-rate-limit]] — Rate limiting must fail-open (never block auth) when Redis is down

## Protocol
- After every `done` task, run `skill self-learning` to extract new patterns/gotchas
- Cross-reference existing entries to avoid duplicates
- New entries use `templates/memory-note.md`

## Process (Jul 2026)
- [[discipline-gates]] — Pre-commit/pre-push gate system (deferral gate, blast-radius, audit closure, plan-review records)
