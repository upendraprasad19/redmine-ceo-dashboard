# Audit Findings — 2026-07-28

## Summary
- **Total findings:** 40
- **P0 (Critical):** 4
- **P1 (High):** 12
- **P2 (Medium):** 14
- **P3 (Low):** 10
- **Lenses covered:** 14/14

---

## P0 — Critical (Fix Immediately)

### AUD-001 — Slack Signature Verification Bypassed (TDZ Bug)
- **Lens:** Security — Auth & Cron
- **File:** `pages/api/slack/events.js:70,82`
- **Description:** Variable declared at line 82 referenced earlier at line 70. Temporal Dead Zone (TDZ) causes ReferenceError, caught silently, returning HTTP 200 for ALL requests.
- **Impact:** Complete Slack security bypass. No signature verification ever runs. Attackers can POST arbitrary data.
- **Proposed Fix:** Move variable declaration before line 70.
- **Regression Test:** Add test that verifies signature check runs before event processing.

### AUD-002 — Missing normalizeEmail() in API Sync
- **Lens:** Data Integrity — Sync / Email
- **File:** `pages/api/sync.js:134`
- **Description:** User sync stores `u.mail` directly without `normalizeEmail()`. Compare with `scripts/sync-redmine.js:104` which correctly normalizes.
- **Impact:** Daily Vercel cron sync stores raw `thinking-code.com` emails, breaking email delivery and password resets.
- **Proposed Fix:** Add `normalizeEmail(u.mail)` call before DB insert.
- **Regression Test:** Add test verifying email normalization in sync path.

### AUD-003 — No Try/Catch in 6 Auth API Endpoints
- **Lens:** Code Quality — Errors
- **Files:** `pages/api/auth/change-password.js`, `pages/api/auth/forgot-password/channels.js`, `pages/api/auth/forgot-password/request.js`, `pages/api/auth/forgot-password/verify.js`, `pages/api/auth/forgot-password/reset.js`, `pages/api/profile/prefs.js`
- **Description:** No top-level try/catch around async DB operations. If DB is down, unhandled rejection returns HTML error page instead of JSON.
- **Impact:** Frontend fetch calls and Telegram bot break on DB failures.
- **Proposed Fix:** Wrap handler body in try/catch, use `send500()`.
- **Regression Test:** Add test for DB failure scenario returning JSON.

### AUD-004 — No E2E Tests Exist
- **Lens:** Test Coverage — Integration Tests
- **File:** `tests/e2e/` (empty directory)
- **Description:** `package.json` defines `test:e2e:smoke` and `test:e2e:critical` but no test files exist. Playwright installed but unused.
- **Impact:** Zero E2E coverage. Critical user paths untested at integration level.
- **Proposed Fix:** Create `tests/e2e/dashboard-clicks.spec.js` and `dashboard-critical.spec.js`.
- **Regression Test:** N/A — tests need to be created.

---

## P1 — High (Fix Before Next Deploy)

### AUD-005 — Morning Briefing Missing Engineering Team Whitelist
- **Lens:** Data Integrity — Time Logs
- **File:** `pages/api/cron/morning-briefing.js:104,146`
- **Description:** "No time log today" count queries ALL active users without filtering by `['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']`.
- **Impact:** Managers receive inflated counts including non-engineering teams.
- **Proposed Fix:** Add `AND team = ANY(ARRAY['AI','DB','DevOps','JS/UI','Java','QA']::text[])` to queries.
- **Regression Test:** Verify count excludes non-engineering teams.

### AUD-006 — Duplicated statusMap (4 files)
- **Lens:** Code Quality — Constants
- **Files:** `pages/api/sync.js:172`, `scripts/sync-redmine.js:179`, `scripts/sync-backfill.js:26`, `crons/weekly-reconcile.js:21`
- **Description:** Identical 11-entry status mapping copy-pasted across 4 files.
- **Impact:** High drift risk if Redmine statuses change.
- **Proposed Fix:** Extract to `lib/constants.js`, import everywhere.
- **Regression Test:** Gate script already detects this class.

### AUD-007 — Duplicated priorityMap (4 files)
- **Lens:** Code Quality — Constants
- **Files:** `pages/api/sync.js:185`, `scripts/sync-redmine.js:192`, `scripts/sync-backfill.js:39`, `crons/weekly-reconcile.js:34`
- **Description:** Identical 5-entry priority mapping duplicated.
- **Impact:** Same drift risk as AUD-006.
- **Proposed Fix:** Extract to `lib/constants.js`.
- **Regression Test:** Gate script already detects this class.

### AUD-008 — Duplicated EXPECTED_TIME_TEAMS (7 files)
- **Lens:** Code Quality — Constants
- **Files:** `pages/api/overview.js:6`, `pages/api/timelogs.js:6`, `pages/api/no-timelog.js:5`, `pages/api/pm-pulse/developer-load.js:6`, `pages/api/profile/snapshot.js:6`, `components/Dashboard.js:2312`, `scripts/check-engineering-filter.js:11`
- **Description:** Engineering team whitelist copied 7 times.
- **Impact:** Adding a team requires 7-file update.
- **Proposed Fix:** Extract to shared constant.
- **Regression Test:** Gate script already detects this class.

### AUD-009 — Duplicated APPROVED_PROJECT_IDS (12 files)
- **Lens:** Code Quality — Constants
- **Files:** 12 locations including `scripts/sync-redmine.js:116`, `scripts/sync-backfill.js:21`, `pages/api/tickets.js:6`, `pages/api/overview.js:7`, `pages/api/cron/morning-briefing.js:12`, etc.
- **Description:** Project ID list duplicated 12 times. Gate script only checks 4.
- **Impact:** Highest drift risk constant in codebase.
- **Proposed Fix:** Expand gate script to check all 12 files.
- **Regression Test:** Gate script already checks 4 files.

### AUD-010 — 6 API Routes Bypass send500()
- **Lens:** Code Quality — Errors
- **Files:** `pages/api/chat.js:146`, `pages/api/one-on-one.js:123`, `pages/api/sync.js:289`, `pages/api/sync-full.js:27`, `pages/api/sync-leave.js:101`, `pages/api/auth/login.js:79`
- **Description:** Use inline `res.status(500).json()` instead of `send500()`.
- **Impact:** Inconsistent error handling, harder to grep Vercel logs.
- **Proposed Fix:** Replace with `send500(res, err, context)`.
- **Regression Test:** Gate script already detects this class.

### AUD-011 — No Rate Limiting on Password Reset Endpoints
- **Lens:** Security — Auth & Cron
- **Files:** `pages/api/auth/forgot-password/request.js`, `pages/api/auth/forgot-password/verify.js`
- **Description:** Login has rate limiting but forgot-password flow does not. Enables brute-force on 6-digit codes.
- **Impact:** Attackers can spam reset codes or brute-force verification.
- **Proposed Fix:** Add `checkRateLimit` to both endpoints.
- **Regression Test:** Verify rate limit rejects excess requests.

### AUD-012 — No Rate Limiting on /api/chat (AI Spend)
- **Lens:** Security — API
- **File:** `pages/api/chat.js:8`
- **Description:** AI chat endpoint has no rate limiting. Each request costs money per token.
- **Impact:** Unbounded AI API costs, potential DoS.
- **Proposed Fix:** Add `checkRateLimit` (e.g., 30 req/min per user).
- **Regression Test:** Verify rate limit enforced.

### AUD-013 — No Rate Limiting on /api/sync
- **Lens:** Security — API
- **File:** `pages/api/sync.js:83`
- **Description:** Authenticated users can trigger full sync repeatedly. Each sync hits Redmine API + hundreds of DB operations.
- **Impact:** Service degradation from excessive sync operations.
- **Proposed Fix:** Add rate limit + sync_state timestamp check.
- **Regression Test:** Verify rate limit enforced.

### AUD-014 — Developer Load Query Missing Approved Project Filter
- **Lens:** Data Integrity — Time Logs
- **File:** `pages/api/pm-pulse/developer-load.js:50-51,80`
- **Description:** Developer load count includes non-approved project tickets.
- **Impact:** Misleading workload metrics in PM Pulse dashboard.
- **Proposed Fix:** Add `AND project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(...))`.
- **Regression Test:** Verify count only includes approved projects.

### AUD-015 — err.message Exposed in Cron Batch Response
- **Lens:** Telemetry / Error Tracking
- **File:** `pages/api/cron/run.js:164`
- **Description:** Failed jobs include `error: err.message` in JSON response.
- **Impact:** Internal error details leaked to API caller.
- **Proposed Fix:** Replace with generic `error: 'Job failed'`.
- **Regression Test:** Verify response doesn't contain err.message.

### AUD-016 — Missing Security Headers
- **Lens:** Security — API
- **File:** `next.config.js:4-15`
- **Description:** Missing X-Powered-By, Content-Security-Policy, Permissions-Policy, X-XSS-Protection headers.
- **Impact:** Framework fingerprinting, increased XSS surface.
- **Proposed Fix:** Add missing headers.
- **Regression Test:** Verify headers present in response.

---

## P2 — Medium (Fix Within Sprint)

### AUD-017 — Rate Limiter Fail-Open on Redis Outage
- **Lens:** Security — Auth & Cron
- **File:** `pages/api/auth/login.js:29-31`
- **Description:** Rate limiter silently bypassed when Redis is down.
- **Impact:** Brute-force attacks possible during Redis outages.
- **Proposed Fix:** Consider fail-closed for auth or in-memory fallback.

### AUD-018 — forgot-password/channels.js Leaks User Existence
- **Lens:** Security — Auth & Cron
- **File:** `pages/api/auth/forgot-password/channels.js:17-21`
- **Description:** Response shape differs for existing vs non-existing users.
- **Impact:** Username enumeration.
- **Proposed Fix:** Always return identical response shape.

### AUD-019 — Middleware Public Path /api/cron Too Broad
- **Lens:** Security — Auth & Cron
- **File:** `middleware.js:11`
- **Description:** `/api/cron` bypass matches all sub-paths, trusting each endpoint to verify CRON_SECRET.
- **Impact:** Future cron endpoint without CRON_SECRET would be unauthenticated.
- **Proposed Fix:** Remove `/api/cron` from PUBLIC_PATHS.

### AUD-020 — 8 Unmonitored Copies of APPROVED_PROJECT_IDS
- **Lens:** Data Integrity — Projects
- **Files:** `pages/api/sync.js:36`, `crons/health-check.js:21`, `pages/api/pm-pulse/executive-snapshot.js:6`, `pages/api/pm-pulse/anomalies.js:6`, `pages/api/cron/friday-summary.js:12`, `pages/api/cron/morning-briefing.js:12`, `scripts/backfill-do.js:20`, `src/lib/approved-projects.js:4`
- **Description:** Gate script only checks 4 of 12 total copies.
- **Impact:** Unmonitored drift risk.
- **Proposed Fix:** Expand gate script to check all 12 files.
- **Regression Test:** Update check-approved-projects-sync.js.

### AUD-021 — sync-backfill.js Missing Email on User Creation
- **Lens:** Data Integrity — Email
- **File:** `scripts/sync-backfill.js:98-121`
- **Description:** `getNeonUserId()` creates user without email field.
- **Impact:** Low — backfill is one-time, full sync populates emails later.
- **Proposed Fix:** Add email to INSERT statement.

### AUD-022 — Mixed import/require in pages/api/ Files
- **Lens:** Code Quality — Module System
- **Files:** `pages/api/overview.js`, `pages/api/timelogs.js`, `pages/api/tickets.js`, `pages/api/people.js`, `pages/api/profile/snapshot.js`, `pages/api/pm-pulse/developer-load.js`, `pages/api/pm-pulse/executive-snapshot.js`, `pages/api/pm-pulse/anomalies.js`
- **Description:** 8 files use both ESM import and CJS require.
- **Impact:** Inconsistent module system, future breakage risk.
- **Proposed Fix:** Standardize on ESM import for pages/api/.

### AUD-023 — 22 pages/api/ Files Use CJS require Exclusively
- **Lens:** Code Quality — Module System
- **Files:** 22 files including chat.js, sync.js, auth/*.js, etc.
- **Description:** Convention says pages/api/ should use ESM, but most use require.
- **Impact:** Convention violation, toolchain fragility.
- **Proposed Fix:** Migrate to ESM import incrementally.

### AUD-024 — Mixed CJS/ESM in scripts/ Directory
- **Lens:** Code Quality — Module System
- **Files:** 7 ESM scripts (sync-redmine.js, sync-backfill.js, etc.) vs CJS scripts (board.js, check-*.js, etc.)
- **Description:** Convention says scripts/ should use CJS, but 7 use ESM.
- **Impact:** Inconsistent module system.
- **Proposed Fix:** Migrate ESM scripts to CJS or update convention.

### AUD-025 — check-module-system.js Regex Bug
- **Lens:** Code Quality — Module System
- **File:** `scripts/check-module-system.js:59`
- **Description:** `!content.includes('require(') === false` evaluates incorrectly.
- **Impact:** Gate script may miss violations.
- **Proposed Fix:** Fix regex logic.

### AUD-026 — Coverage Threshold Not Enforced in CI
- **Lens:** Test Coverage — Unit Tests
- **File:** `vitest.config.js:14`
- **Description:** 60% coverage threshold only checked via `test:coverage`, not in pre-commit or CI.
- **Impact:** Coverage could silently regress.
- **Proposed Fix:** Add `vitest run --coverage` to CI pipeline.

### AUD-027 — Schema Contract Out of Sync
- **Lens:** DB Column Drift
- **Files:** `schema/contract.sql`, `scripts/migrations/023-drop-orphan-tables.sql`
- **Description:** Contract contains 9 tables that migration 023 drops.
- **Impact:** Developers may reference dropped tables.
- **Proposed Fix:** Regenerate contract after migration 023.

### AUD-028 — Latent SQL Injection Pattern
- **Lens:** Security — API
- **File:** `lib/gpt-executor.js:58`
- **Description:** `created_since` interpolated into raw SQL string (currently unused).
- **Impact:** Ticking time bomb if variable is ever used.
- **Proposed Fix:** Remove dead code or use parameterized queries.

### AUD-029 — 8 lib/ Modules Without Unit Tests
- **Lens:** Test Coverage — Unit Tests
- **Files:** `lib/db.js`, `lib/redis.js`, `lib/admin.js`, `lib/chat-enrichment.js`, `lib/gpt-executor.js`, `lib/rate-limit.js`, `lib/table-audit.js`, `lib/ai.js`
- **Description:** Critical modules (db.js, redis.js) have no tests.
- **Impact:** Regression bugs go undetected.
- **Proposed Fix:** Add unit tests for each module.

### AUD-030 — E2E Scripts Reference Non-Existent Files
- **Lens:** Test Coverage — Integration Tests
- **File:** `package.json:13-14`
- **Description:** test:e2e:smoke and test:e2e:critical point to non-existent spec files.
- **Impact:** False sense of security.
- **Proposed Fix:** Create spec files or remove scripts.

### AUD-031 — Playwright Installed But Unused
- **Lens:** Test Coverage — Integration Tests
- **File:** `package.json:53`
- **Description:** `@playwright/test` in devDependencies but no .spec.js files.
- **Impact:** Dead dependency.
- **Proposed Fix:** Create tests or remove dependency.

---

## P3 — Low (Fix When Convenient)

### AUD-032 — Duplicate console.error in sync-leave.js
- **Lens:** Code Quality — Errors
- **File:** `pages/api/sync-leave.js:99-100`
- **Description:** Copy-paste mistake logs error twice.
- **Impact:** Duplicate log output.
- **Proposed Fix:** Remove duplicate line.

### AUD-033 — e.message Logged in Console (Acceptable)
- **Lens:** Code Quality — Errors
- **Files:** 5 files with server-side console.error(err.message)
- **Description:** Acceptable pattern for server-side logging.
- **Impact:** Low risk (not exposed to client).
- **Proposed Fix:** None required.

### AUD-034 — Middleware Public Path Note
- **Lens:** Security — Auth & Cron
- **File:** `middleware.js:11`
- **Description:** Informational — /api/cron path is intentionally public for cron auth.
- **Impact:** By design.
- **Proposed Fix:** None required.

### AUD-035 — sync-full.js Child Process Behind Auth
- **Lens:** Security — API
- **File:** `pages/api/sync-full.js:17-21`
- **Description:** Spawns child process behind CRON_SECRET auth.
- **Impact:** Blast radius if secret compromised.
- **Proposed Fix:** Consider IP restriction.

### AUD-036 — Mixed require/import in Test Files
- **Lens:** Test Coverage — Unit Tests
- **Files:** `tests/unit/intimation-relay.test.js`, `auth.test.js`, etc.
- **Description:** Uses require() for mocks, import for module under test.
- **Impact:** Fragile if vitest changes behavior.
- **Proposed Fix:** Standardize on ESM import.

### AUD-037 — Migration 022 Catches Outside-Framework Changes
- **Lens:** DB Column Drift
- **File:** `scripts/migrations/022-add-missing-columns.sql`
- **Description:** Columns added to live DB outside migration framework.
- **Impact:** Informational — suggests past discipline gaps.
- **Proposed Fix:** None required.

### AUD-038 — No Structured Logging Framework
- **Lens:** Telemetry / Error Tracking
- **Files:** All production code
- **Description:** Uses raw console.log/error instead of structured logging.
- **Impact:** Harder to filter/search logs in production.
- **Proposed Fix:** Consider pino or winston (optional).

### AUD-039 — Excessive console.log in Production
- **Lens:** Telemetry / Error Tracking
- **Files:** 53 occurrences in pages/api/, 56 in crons/, 44 in bots/
- **Description:** Extensive operational logging (standard for Vercel).
- **Impact:** Low risk (Vercel logs are access-controlled).
- **Proposed Fix:** None required for Vercel deployment.

### AUD-040 — Duplicate send500 Import Check
- **Lens:** Code Quality — Errors
- **Files:** Various
- **Description:** send500 correctly imported from single source (lib/api-error.js).
- **Impact:** Positive finding.
- **Proposed Fix:** None required.

---

## Positive Findings (Good Practices Observed)

1. **Auth middleware** correctly gates all non-public routes
2. **JWT cookie** uses httpOnly, secure, sameSite strict
3. **bcrypt** correctly used for password hashing (cost factor 10)
4. **send500** properly hides error details in most routes
5. **Cron endpoints** consistently verify CRON_SECRET
6. **Admin endpoints** use requireAdmin or checkAccess
7. **SSRF protection** in sync-leave.js validates hostname/IP
8. **Timing-safe comparison** used in Slack verification
9. **All SQL queries** use Neon tagged template literals (safe)
10. **No inline Telegram fetches** — all use lib/telegram.js
11. **All 140 unit tests pass** — 100% pass rate
12. **Approved project filter** applied in all 4 documented sync files
13. **Delivery Owner mapping** correct across all sync paths
