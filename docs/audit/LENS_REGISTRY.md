# Lens Registry — Redmine CEO Dashboard

14 canonical audit lenses for comprehensive project auditing. Adapted from AVYA's 53-lens registry, optimized for Next.js + Redmine + Telegram + Auth stack.

---

## Security Lenses

### Lens 1: Security — Auth & Cron
**Scope**: Authentication patterns, session management, cron security
**Checklist**:
- [ ] All API routes check session cookie OR CRON_SECRET header (no bare `req.query.key`)
- [ ] `dashboard_users.password_hash` uses bcrypt on every write
- [ ] Rate limiter fails-open for auth endpoints (never block login)
- [ ] CRON_SECRET header only (never `req.query.secret`) — per vault `[[rate-limiting-sliding-window]]`
- [ ] Vercel cron cap respected — routes via `pages/api/cron/run.js` `JOB_MAP`
- [ ] JWT_SECRET validated at startup (throws if missing)

**Vault Patterns**: `[[dual-auth-api]]`, `[[rate-limiting-sliding-window]]`, `[[fail-open-rate-limit]]`

---

### Lens 2: Security — API
**Scope**: API security, error handling, SSRF protection
**Checklist**:
- [ ] `send500()` used in all catch blocks (no `err.message` leak) — per vault `[[api-error-sanitization]]`
- [ ] Dual-auth pattern: server secret header OR session cookie for protected routes
- [ ] SSRF protection on external URL fetches (getCurrentUser + IP validation)
- [ ] No query-string secrets in server logs
- [ ] Security headers in `next.config.js` (HSTS, nosniff, DENY frame, referrer-policy)

**Vault Patterns**: `[[api-error-sanitization]]`, `[[dual-auth-api]]`

---

## Data Integrity Lenses

### Lens 3: Data Integrity — Sync
**Scope**: Redmine→Neon sync correctness, entity resolution
**Checklist**:
- [ ] Delivery Owner enum→user mapping correct (enum label → `users.name`, NOT Redmine user ID)
- [ ] `normalizeEmail()` called before storing/syncing emails
- [ ] Delta sync vs full sync paths both work correctly
- [ ] `sync_state.last_synced_at` updated after sync
- [ ] Approved project filter applied on all sync queries

**Vault Patterns**: `[[delivery-owner-enum-vs-userid]]`, `[[sync-pattern]]`

---

### Lens 4: Data Integrity — Email
**Scope**: Email normalization, domain consistency
**Checklist**:
- [ ] `normalizeEmail()` from `lib/email-utils.js` used before storing ANY email
- [ ] No raw `thinking-code.com` / `mail.thinking-code.com` references in DB
- [ ] All emails stored as `thinkingcode.com` (no hyphen)
- [ ] `lib/email.js` (`sendReport`, `sendText`) normalizes `to` internally
- [ ] `scripts/sync-redmine.js` normalizes on sync into `users.email`

**Vault Patterns**: None explicitly documented, but AGENTS.md §Company domain rule

---

### Lens 5: Data Integrity — Projects
**Scope**: Approved project ID consistency
**Checklist**:
- [ ] `APPROVED_PROJECT_IDS` identical in `scripts/sync-redmine.js`
- [ ] `APPROVED_PROJECT_IDS` identical in `scripts/sync-backfill.js`
- [ ] `APPROVED_REDMINE_IDS` identical in `pages/api/tickets.js`
- [ ] `APPROVED_PROJECT_IDS` identical in `scripts/cleanup-before-oct1.js`
- [ ] All 4 files have same set of Redmine project IDs

**Vault Patterns**: `[[approved-project-filter]]`

---

### Lens 6: Data Integrity — Time Logs
**Scope**: Engineering-team whitelist enforcement
**Checklist**:
- [ ] Every "X people haven't logged time" count filters by `['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']`
- [ ] Applied in `pages/api/overview.js`
- [ ] Applied in `pages/api/timelogs.js`
- [ ] Applied in `pages/api/no-timelog.js`
- [ ] Applied in `pages/api/pm-pulse/developer-load.js`

**Vault Patterns**: None explicitly documented, but AGENTS.md §Time-logging audience

---

## Code Quality Lenses

### Lens 7: Code Quality — Constants
**Scope**: Duplicated constants, drift detection
**Checklist**:
- [ ] Status maps not duplicated across files (check `pages/api/tickets.js`, `scripts/sync-redmine.js`)
- [ ] Team names array consistent where used
- [ ] Role values consistent (`manager`, `team_lead`, `developer`)
- [ ] No hardcoded magic strings that should be constants
- [ ] `send500()` imported from single source (`lib/api-error.js`)

**Vault Patterns**: `[[sync-status-map-duplication]]`

---

### Lens 8: Code Quality — Errors
**Scope**: Error handling, telemetry, async patterns
**Checklist**:
- [ ] No `err.message` in API responses (use `send500()`)
- [ ] Unhandled async errors before try/catch caught (returns HTML 500)
- [ ] All catch blocks in API routes call `send500()`
- [ ] No silent `console.log` for errors (use structured logging)
- [ ] Error paths have telemetry if applicable

**Vault Patterns**: `[[unhandled-async-before-trycatch]]`

---

### Lens 9: Code Quality — Naming
**Scope**: File, variable, DB column naming conventions
**Checklist**:
- [ ] Page files: `pages/` — kebab-case.js
- [ ] API route files: `pages/api/` — kebab-case.js in domain dirs
- [ ] Library modules: `lib/` — kebab-case.js, CommonJS
- [ ] Bot modules: `bots/` — CommonJS
- [ ] Cron modules: `crons/` — kebab-case.js, CommonJS
- [ ] DB tables: snake_case, plural
- [ ] DB columns: snake_case

**Vault Patterns**: None explicitly documented, but AGENTS.md §Naming conventions

---

### Lens 10: Code Quality — Module System
**Scope**: CJS/ESM boundary enforcement
**Checklist**:
- [ ] `lib/` uses CommonJS (`require`/`module.exports`)
- [ ] `scripts/` uses CommonJS
- [ ] `bots/` uses CommonJS
- [ ] `crons/` uses CommonJS
- [ ] `pages/api/` uses ESM (`import`/`export`)
- [ ] `tests/unit/` uses ESM with `.js` extensions on relative imports
- [ ] No `require()` in ESM files
- [ ] No `import` in CJS files without dynamic import

**Vault Patterns**: None explicitly documented, but AGENTS.md §Module system

---

## Test Lenses

### Lens 11: Test Coverage — Unit Tests
**Scope**: Unit test coverage for lib/ modules
**Checklist**:
- [ ] All `lib/` modules have corresponding test in `tests/unit/`
- [ ] Tests use ESM (`import`) not `require('vitest')`
- [ ] CJS mocking uses `vi.spyOn(require(...))` pattern
- [ ] No pre-existing test failures labeled "pre-existing"
- [ ] `npm run test:unit` passes

**Vault Patterns**: `[[cjs-mocking-in-vitest]]`

---

### Lens 12: Test Coverage — Integration Tests
**Scope**: E2E test coverage
**Checklist**:
- [ ] Critical paths have E2E tests in `tests/e2e/`
- [ ] `npm run test:e2e:smoke` passes
- [ ] `npm run test:e2e:critical` passes
- [ ] Tests don't remove `test:e2e*` scripts from `package.json`

**Vault Patterns**: None explicitly documented

---

## Infrastructure Lenses

### Lens 13: DB Column Drift
**Scope**: Migration renames, schema consistency
**Checklist**:
- [ ] Column names in code match DB schema (check `information_schema.columns`)
- [ ] Migration files don't rename columns without code updates
- [ ] `health-check.js` uses correct column names
- [ ] `scripts/sync-redmine.js` column references match schema
- [ ] `scripts/migrations/` files reviewed for column renames

**Vault Patterns**: `[[health-check-broken-column-ref]]`

---

### Lens 14: Telemetry / Error Tracking
**Scope**: Error observability, logging
**Checklist**:
- [ ] Error paths have telemetry `op_type` if applicable
- [ ] Success paths logged for critical operations
- [ ] Generic catch blocks don't silently swallow errors
- [ ] `lib/telegram.js` used for Telegram sends (no inline fetch)
- [ ] No `console.log` for production errors (structured logging only)

**Vault Patterns**: None explicitly documented

---

## Lens Selection Guide

| Audit Type | Lenses to Run |
|---|---|
| **Security Audit** | 1, 2 |
| **Data Integrity Audit** | 3, 4, 5, 6 |
| **Code Quality Audit** | 7, 8, 9, 10 |
| **Test Audit** | 11, 12 |
| **Infrastructure Audit** | 13, 14 |
| **Full Audit** | 1-14 (all) |
| **Pre-deploy Audit** | 1, 2, 3, 4, 5, 6 (Security + Data Integrity) |

---

## Execution Notes

1. **Run gate scripts first** — `npm run audit:gates`
2. **Reference vault patterns** — check `vault/INDEX.md` for existing gotchas
3. **Document findings** — use format from `AUDIT_PLAYBOOK.md`
4. **No deferrals** — every finding gets terminal state in closures YAML
5. **Update vault** — new patterns discovered during audit go to `vault/patterns/` or `vault/gotchas/`
