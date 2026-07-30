# Redmine CEO Dashboard — Agent instructions

## ▸ MANDATORY SESSION PROTOCOL (no exceptions) ◂

Every time you start work AND after every edit file/tool call, you MUST follow this chain. Do not wait for the user to remind you.

---

### A. Session start
1. **Run bootstrap**: `npm run bootstrap` — surfaces board state, vault freshness, discipline checklist
2. **Read board**: `.opencode/board/INDEX.md` — what's active/blocked/backlog
3. **Read vault**: `.opencode/vault/INDEX.md` — check existing patterns + gotchas
4. **Read git status**: know what files are dirty before you touch anything
5. **Run env check**: confirm `.env.local` has valid `DATABASE_URL` and `REDMINE_API_KEY` (skip if in CI)

### B. Plan-first mode — tiered (MANDATORY)

No code is written without a plan first. The July 2026 incident (project ordering fix
coded without planning) proved that even "trivial" UI changes can have edge cases — but
not every change needs the full ceremony. Use the tier table to right-size the process.

**Rule: When in doubt, go one tier up.**

| Tier | Scope | Plan | Reviewer | Approval | Commit lock |
|------|-------|------|----------|----------|-------------|
| **T0** | Trivial: typo / comment / config / log line | No plan file | None | None (one-line done note after) | Per D.5 if committing |
| **T1** | Small: single-file fix or feature | Lightweight plan (what / why / files / verify) + self-review | None (NO reviewer subagent) | Required (plan-first) | Per D.5 if committing |
| **T2** | Feature / schema / sync / multi-file | Full plan (current §B chain below) | `reviewer` subagent required | Required | Required (D.5) |

**T1 self-review checklist** (substitute for the reviewer subagent):
- Conventions match neighbours (module system, naming, snake_case).
- No secrets logged, no auth bypass, no raw SQL injection surface.
- Trace user click path through all UI states affected by the change.
- One-line done note added to `board/` after.

**Full T2 protocol (the original chain):**
1. **Analyze**: Read relevant files, check AGENTS.md conventions, check vault patterns
2. **Write plan**: Create a task file in `board/active/` with:
   - What needs to change and why
   - Files to be modified (with line numbers if known)
   - Data flow / architecture impact
   - Test/verification strategy
   - Risks and edge cases
3. **Review plan**: Use the `reviewer` subagent to independently review the plan for:
   - Architecture violations
   - Security issues (secrets, auth bypasses, SQL injection)
   - Schema convention breaks
   - Missed edge cases
   - Consistency with existing patterns
4. **Present for approval**: Show the plan + review findings to the user. Do NOT build until user explicitly approves.
5. **Build**: Only after approval, implement. Tag each edit with its plan step number.
5.5. **Verify**: Before archiving, confirm:
    - **Completeness**: Every file listed in the plan was modified. No orphaned changes.
    - **Correctness**: `npm run test:unit` passes. `npm run build` succeeds (if applicable).
    - **Coherence**: Changes are consistent with each other and with existing patterns (check vault, check naming conventions).
    - If any check fails, do NOT proceed to commit lock. Return to step 5 (Build) and fix.
6. **Commit lock**: Do NOT commit or push until the pre-commit code review in Section D.5 is completed and the user explicitly approves.

**Protocol lines (apply at all tiers):**
- **(a) Production incident**: Any prod incident → write a gotcha to `vault/gotchas/` AND
  an incident note from the `incident.md` postmortem template (impact / root cause / fix /
  prevention). Cross-reference both in `vault/INDEX.md`.
- **(b) Retro process pointer**: Every 5 done tasks (or monthly, whichever first), run the
  retro described in `board/RETRO.md` — read `board/done/` + `vault/`, count throughput,
  surface recurring gotchas as systemic signals, propose process tweaks.

### C. Post-edit discipline (RUN THIS AFTER EVERY EDIT, EVERY TIME)
1. **Run tests**: `npm run test:unit` — all must pass
2. **Update board**: run `node scripts/board.js start NNN` or `done NNN "summary"`; run `node scripts/board.js sync` if manual edits happened
3. **Update vault** if the edit revealed a pattern/gotcha/optimization:
   - Write note to `vault/patterns/` or `vault/gotchas/` using the template at `C:\Users\Dell\.config\opencode\templates\memory-note.md`
   - Update `vault/INDEX.md`
4. **Dev server check**: if `npm run dev` is not running, start it (`Start-Process cmd /c "npm run dev" -WindowStyle Hidden`) and wait 8s; open http://localhost:3000 to verify no page crash

### D. Pre-commit quality gates (BEFORE push to main)
1. **All tests pass**: `npm run test:unit` (and `npm run test:e2e:smoke` if e2e infra available)
2. **Build check**: `npm run build` — must succeed (or `npx next build` if build script exists)
3. **Self-learning**: run `skill self-learning` after the batch
4. **DB drift check** (see section below)
5. **Code review**: Present diff summary (files changed, lines added/removed, full diff) to the user. Do NOT commit until user explicitly approves.
6. **Vault + board are current**: INDEX.md files reflect all work done
7. **Discipline gates**: Pre-commit runs deferral-euphemism gate (`check-no-deferral.js`) + audit-closure validator (`validate-audit-closure.js`) + discipline check (`check-discipline.js`). Pre-push runs blast-radius tiering (`blast-radius.js`) and skips full suite for feature-only changes.

---

## Task board protocol
Board: `.opencode/board/`. Maintained via `scripts/board.js`:

- **Creating a task**: `node scripts/board.js create "slug" "Description"`
- **Starting a task**: `node scripts/board.js start NNN`
- **Done**: `node scripts/board.js done NNN "Summary"`
- **Blocked**: Add `**Blocked by:** <reason>` to active task. Leave in `active/`.
- **Validate**: `node scripts/board.js validate` (exit 1 on mismatch)
- **Sync INDEX.md**: `node scripts/board.js sync` (rebuild from files on disk)

Task filenames: `NNN-short-description.md` (zero-padded). The `todowrite` tool should mirror the board — keep them in sync.

## Memory vault protocol
Vault: `.opencode/vault/`. Obsidian-style markdown.

- **Write**: After new discoveries, write to `vault/patterns/` or `vault/gotchas/` using `templates/memory-note.md`
- **Cross-reference**: Use `[[wikilinks]]` within vault; link to `docs/decisions/` ADRs
- **Index**: Update `vault/INDEX.md` with links to every new entry

## Self-learning
Run `skill self-learning` after completing a batch of tasks. It scans `board/done/`, cross-references vault entries, and proposes new knowledge entries and workflow improvements.

## DB audit / SOT drift check protocol
Before deploying changes that touch data sync, run these checks:

### Source-of-truth (SOT) audit
1. **Redmine count check**: Hit `GET /projects.json?limit=1` — confirm API is responsive and returns expected project count
2. **Issue count drift**: Compare `SELECT COUNT(*) FROM issues WHERE redmine_project_id = ANY($APPROVED)` against a Redmine API count of open issues for approved projects. Flag if >5% difference.
3. **Delivery Owner drift**: `SELECT COUNT(*) FROM issues WHERE delivery_owner_ids IS NULL OR array_length(delivery_owner_ids,1) = 0 AND status NOT IN ('Closed','Resolved')` — should be near-zero after backfill.
4. **Sync staleness**: Check `sync_state.last_synced_at` — warn if >24h stale.

### Read/write drift check
5. **User sync drift**: Count of `users` in Neon vs Redmine user list. Flag >5% difference.
6. **Time entry drift**: Sum of hours in Neon vs Redmine time entries for last 7 days. Flag >2h difference.

### When to run
- Before any commit that touches `scripts/sync-*`, `pages/api/sync*`, or any query in `pages/api/` that reads `issues` or `time_entries`
- Weekly even if no changes — now automated via `crons/health-check.js` (registered in `pages/api/cron/run.js` JOB_MAP + `vercel.json` weekly schedule `0 4 * * 1`). Run `curl /api/cron/run?job=health-check` to trigger on demand.

## Dev server management
- Start with: `Start-Process cmd /c "npm run dev" -WindowStyle Hidden -WorkingDirectory "D:\Upendra\redmine-ceo-dashboard"`
- Verify with: `curl.exe -s --max-time 5 -o NUL -w "%{http_code}" http://localhost:3000` (should return 307 or 200)
- Kill stale servers before restarting

## Things to include in every response (auto-prompt for user)
When a user asks "what did we do", respond with:
1. Board status (active/done/backlog)
2. Test results (last run)
3. Vault updates since last session
4. **Discipline gate status**: bootstrap passed/failed, plan gate active, blocked action count
5. **Compliance report**: whether session-start and plan-first gates were enforced in this session

---

## Project overview
Next.js (pages router) dashboard that pulls Redmine data into a Neon Postgres DB and surfaces it as per-role (manager / team_lead) views. Deployed on Vercel.

- **Data sources**: Redmine REST API (source of truth), Neon (local cache), Upstash Redis (volatile state), Telegram (bot + notifications), SMTP via Nodemailer (`lib/email.js`), OpenRouter via `lib/ai.js`.
- **Auth**: JWT session cookie (`ceo_session`), bcrypt password hashes in `dashboard_users.password_hash`. See `lib/auth.js`.
- **Production branch**: `main`. Push to main → Vercel auto-deploys.

## Company domain rule (IMPORTANT)
The company domain is **`thinkingcode.com`** (no hyphen). Redmine stores the old `thinking-code.com` / `mail.thinking-code.com` form.

- **Always** normalize via `normalizeEmail()` from `lib/email-utils.js` before storing an email in our DB OR before passing it to any send function.
- `lib/email.js` (`sendReport`, `sendText`) already normalizes `to` internally; just pass whatever you have.
- `scripts/sync-redmine.js` normalizes on sync into `users.email`.

## Time-logging audience
Only the engineering teams are expected to log time: `['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']`.

Every "X people haven't logged time" count **must** filter by this whitelist. Already applied in: `pages/api/overview.js`, `pages/api/timelogs.js`, `pages/api/no-timelog.js`, `pages/api/pm-pulse/developer-load.js`.

## Approved projects
The full list of Redmine project IDs we track is duplicated in:
- `scripts/sync-redmine.js` (`APPROVED_PROJECT_IDS` constant)
- `scripts/sync-backfill.js` (same constant)
- `pages/api/tickets.js` (`APPROVED_REDMINE_IDS` array — used as filter)
- `scripts/cleanup-before-oct1.js` (same IDs)

If you change the set, update **all four**. We have not consolidated to a shared constant yet (each file needs standalone require semantics to keep serverless cold-start happy).

## Delivery Owner = per-ticket Manager
"Delivery Owner" (Redmine custom field id **25**) is an **enumeration** field, not a User field. Its values are internal enum IDs scoped to this field — NOT Redmine user IDs. Mapping enum → Neon user happens at sync time by matching the enum's `label` to `users.name`. See `buildDeliveryOwnerEnumMap()` in `scripts/sync-redmine.js` / `scripts/sync-backfill.js`.

Resolved IDs are stored in `issues.delivery_owner_ids INTEGER[]`. Queries that need the "Manager" column should unnest this array — see `pages/api/tickets.js` and `pages/api/pm-pulse/executive-snapshot.js` for the pattern.

## Telegram sending
Use `sendTelegramMessage(chatId, text, { parseMode })` from `lib/telegram.js`. Do NOT inline `fetch('https://api.telegram.org/bot...')` in new code — the helper reads `TELEGRAM_BOT_TOKEN` from env and handles the missing-token case.

## Profile, password management, notifications
- **Sidebar avatar** opens `ProfilePanel` (slide-in from right).
- **Change password** (logged in): `POST /api/auth/change-password`
- **Forgot password** (logged out): 4-step flow at `/forgot-password`, endpoints under `pages/api/auth/forgot-password/`. Uses Telegram and/or email, falling back gracefully. Backed by `password_reset_tokens` table.
- **Notification channels**: `dashboard_users.notification_channels TEXT[]` (values `'telegram'` and/or `'email'`). Users toggle in their profile.

## Module system (important when adding files)
- **CommonJS** (`require` / `module.exports`) in `lib/`, `bots/`, `crons/`, and migration scripts. When adding a new module in those dirs, match neighbours.
- **ESM** (`import`/`export`) in `pages/api/**` (Next.js default) and **required** in `tests/unit/**/*.test.js` — vitest 1.x cannot be imported via `require`. Relative imports inside test files must include the `.js` extension.

## Testing
- **Unit tests** live in `tests/unit/*.test.js`. Run with `npm run test:unit` (or `npm run test:unit:watch`). Tests may mock CJS modules with `vi.spyOn(require('../../lib/foo.js'), 'fnName').mockImplementation(...)` combined with ESM `import` for the module under test.
- **E2E tests** (Playwright): `npm run test:e2e:smoke` (fast) or `npm run test:e2e:critical`. Don't remove the `test:e2e*` scripts from `package.json` when adding new test tooling.
- Before merging any branch that touches shared `lib/` modules, run `npm run test:unit`. If a file you changed has no unit test yet and is pure logic (no network, no DB), consider adding one.

## Intimation Relay (Phase 1 — shipped Apr 2026)
Cross-user Telegram relay so managers/TLs can nudge a developer about a ticket and have responses relayed back. Implemented in:
- `lib/intimation-relay.js` — state machine (create / log event / transition / send / relay / permission matrix).
- `lib/commitments.js` — AI extraction + storage of dev commitments.
- `bots/telegram/handlers/intimation.js` — callback handler.
- `crons/intimation-followup.js`, `crons/commitment-followup.js`, `crons/chat-enrichment.js` — dispatched hourly via `pages/api/cron/run.js` batch handler.
- AI tools: `propose_intimation`, `extract_commitment` in `lib/gpt-tools.js`.

Conventions introduced:
- **Callback prefix `int:*`** reserved for intimation buttons. Any new button in this feature must use this namespace.
- **Developer role** — `dashboard_users.role = 'developer'` users are reply-only in Phase 1 (can respond to intimations, cannot query the bot freely yet). Must pass the consent gate (`/agree`) before replies relay.
- **Tool result intercept pattern** — when an AI tool returns `{ confirm_required: true, preview: {...} }`, the bot intercepts in `bots/telegram/index.js` and renders an inline-keyboard card itself; the AI does not produce text for that tool call. Use this pattern for any other future "confirm before doing" tool.

Design: `docs/superpowers/specs/2026-04-22-intimation-relay-design.md`
Plan: `docs/superpowers/plans/2026-04-22-intimation-relay.md`

## Phase roadmap
- **Phase 1 (shipped):** Intimation Relay + personalization data pipeline (this branch).
- **Phase 2 (planned):** Passive profile learning + training flywheel — read from `chat_history.intent` / `entities` to build per-user profile cards.
- **Phase 3 (planned):** Active personalization signals — pattern-based proactive sends.
- **Phase 4 (planned):** Cross-user intelligence for managers (with consent).

Each future phase gets its own spec + plan under `docs/superpowers/`.

## Deploy workflow
1. Make + verify changes on localhost.
2. `git commit` then `git push origin main`.
3. Vercel auto-deploys. If the production target drifts (preview instead of prod), check Vercel → Settings → Git → Production Branch is `main`, or promote the preview manually.
4. Hourly batch crons are dispatched by **GitHub Actions**
   (`.github/workflows/cron-batch.yml`), not Vercel — Vercel Hobby only allows
   daily crons. The workflow `curl`s `/api/cron/run?job=batch` with
   `CRON_SECRET` header.

## Naming conventions (must follow when adding files)

| Category | Convention | Example |
|----------|-----------|---------|
| Page files (`pages/`) | kebab-case.js | `forgot-password.js`, `team-health.js` |
| API route files (`pages/api/`) | kebab-case.js in domain dirs | `auth/login.js`, `cron/morning-briefing.js` |
| API handler export | `export default async function handler(req, res)` | Uniform across all routes |
| Component files (`components/`) | PascalCase.js, default export | `ProfilePanel.js`, `IntelligenceChat.js` |
| Helper sub-components | PascalCase, same file | `Dot`, `Label`, `BigNum`, `StatusPill` |
| Library modules (`lib/`) | kebab-case.js, CommonJS | `intimation-relay.js`, `email-utils.js` |
| Bot modules (`bots/`) | CommonJS | `bots/telegram/handlers/intimation.js` |
| Cron modules (`crons/`) | kebab-case.js, CommonJS | `morning-briefing.js`, `friday-summary.js` |
| Scripts (`scripts/`) | kebab-case.js | `sync-redmine.js`, `cleanup-before-oct1.js` |
| JS variables/functions | camelCase | `currentUser`, `handleSubmit`, `isTeamLead` |
| DB tables | snake_case, plural | `issues`, `time_entries`, `dashboard_users` |
| DB columns | snake_case | `assigned_to_id`, `delivery_owner_ids` |
| DB indexes | `idx_{table}_{cols}` | `idx_issues_assigned` |
| SQL migrations | `scripts/migrations/{NNN}-{desc}.sql` | `019-intimation-relay.sql` |
| Env variables | UPPER_SNAKE_CASE, prefixed | `TELEGRAM_BOT_TOKEN`, `DATABASE_URL` |
| Test files | `tests/unit/{module}.test.js` | `intimation-relay.test.js` |
| E2E test files | `tests/e2e/{feature}.spec.js` | `dashboard-clicks.spec.js` |
| Config constants | SCREAMING_SNAKE_CASE | `APPROVED_PROJECT_IDS`, `EXPECTED_TIME_TEAMS` |
| AI tool function names | snake_case | `get_tickets`, `extract_commitment` |
| Redis keys | `{ns}:{id}` (lowercase, colon) | `chat:${userId}`, `onboard:${userId}` |
| Bot callback prefix | `int:*` reserved | intimation relay namespace |
| JWT cookie name | `ceo_session` | Already defined |

## Things not to do

- Don't create new `sendTelegramMessage` copies — use the lib. (Phase 1's `tgSend` helpers in `lib/intimation-relay.js`, `crons/intimation-followup.js`, and `crons/commitment-followup.js` pre-date this rule and should be refactored to `lib/telegram.js` in a follow-up pass.)
- Don't store raw `thinking-code.com` emails — always normalize.
- Don't filter "no time log" counts without the engineering-team whitelist.
- Don't treat Delivery Owner values as Redmine user IDs.
- Don't skip bcrypt when touching `dashboard_users.password_hash`.
- Don't add entries to `vercel.json` casually — Hobby plan caps cron count. Prefer routing new crons through `pages/api/cron/run.js` (`JOB_MAP`) when possible.
- Don't use `require('vitest')` in test files — it throws. Use ESM `import` and include the `.js` extension on relative paths.

### Rationalization defense

Each "Don't" has a defense against the excuses an AI (or tired human) will generate to skip it.

**Don't create sendTelegramMessage copies**
| Excuse | Reality |
|--------|---------|
| "It's just a one-liner fetch, why add a dependency?" | The lib handles missing token (returns `{ ok: false }`), error responses, and `parseMode` defaults. Inline copies miss these edge cases and drift apart. Phase 1's `tgSend` helpers prove this — they need refactoring. |

**Don't store raw thinking-code.com emails**
| Excuse | Reality |
|--------|---------|
| "thinking-code.com is the real domain, why normalize?" | Redmine stores the old form (`thinking-code.com`, `mail.thinking-code.com`). Our DB and all downstream queries expect `thinkingcode.com`. A single un-normalized row breaks email lookups, password resets, and notification delivery. |

**Don't filter "no time log" counts without the engineering-team whitelist**
| Excuse | Reality |
|--------|---------|
| "Everyone should log time, the count is more accurate without filtering" | Non-engineering teams (sales, admin, design) don't log time by policy. Including them inflates the "X people haven't logged time" count and creates noise that managers ignore. The whitelist `['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']` is the source of truth. |

**Don't treat Delivery Owner values as Redmine user IDs**
| Excuse | Reality |
|--------|---------|
| "It's a number field, it must be a user ID" | Delivery Owner (custom field 25) is an **enumeration** field. Its values are internal enum IDs scoped to that field — not Redmine user IDs. Mapping enum → user happens at sync time by matching `label` to `users.name`. Querying `users WHERE id = delivery_owner_value` returns wrong results or nothing. |

**Don't skip bcrypt when touching dashboard_users.password_hash**
| Excuse | Reality |
|--------|---------|
| "I'm just updating the role, not the password" | Any write to `dashboard_users` that touches the row without re-hashing risks accidentally storing plaintext. bcrypt is mandatory on every write to `password_hash`. No exceptions. |

**Don't add entries to vercel.json casually**
| Excuse | Reality |
|--------|---------|
| "One more cron won't hurt, it's just a config line" | Vercel Hobby plan has a hard cron cap (2 cron jobs max). We're already at the limit. Every new cron must route through `pages/api/cron/run.js` (`JOB_MAP`) to stay within the cap. Adding directly to `vercel.json` blocks deployment. |

**Don't use require('vitest') in test files**
| Excuse | Reality |
|--------|---------|
| "require is simpler, why use import?" | vitest 1.x cannot be imported via `require()` — it throws `ERR_REQUIRE_ESM`. Test files must use ESM `import` syntax and include `.js` extensions on relative paths. This is a hard technical constraint, not a style preference. |