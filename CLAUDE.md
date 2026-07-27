# Redmine CEO Dashboard — Notes for AI Assistants

Concise conventions for this codebase. Read before editing.

## Project overview
Next.js (pages router) dashboard that pulls Redmine data into a Neon Postgres
DB and surfaces it as per-role (manager / team_lead) views. Deployed on Vercel.

- **Data sources**: Redmine REST API (source of truth), Neon (local cache),
  Upstash Redis (volatile state), Telegram (bot + notifications), SMTP via
  Nodemailer (`lib/email.js`), OpenRouter via `lib/ai.js`.
- **Auth**: JWT session cookie (`ceo_session`), bcrypt password hashes in
  `dashboard_users.password_hash`. See `lib/auth.js`.
- **Production branch**: `main`. Push to main → Vercel auto-deploys. (Both `main` and `master` exist; keep them in sync.)

## Company domain rule (IMPORTANT)
The company domain is **`thinkingcode.com`** (no hyphen). Redmine stores the
old `thinking-code.com` / `mail.thinking-code.com` form.

- **Always** normalize via `normalizeEmail()` from `lib/email-utils.js` before
  storing an email in our DB OR before passing it to any send function.
- `lib/email.js` (`sendReport`, `sendText`) already normalizes `to` internally;
  just pass whatever you have.
- `scripts/sync-redmine.js` normalizes on sync into `users.email`.

## Time-logging audience
Only the engineering teams are expected to log time:
`['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']`.

Every "X people haven't logged time" count **must** filter by this whitelist.
Already applied in: `pages/api/overview.js`, `pages/api/timelogs.js`,
`pages/api/no-timelog.js`, `pages/api/pm-pulse/developer-load.js`.

## Approved projects
The full list of Redmine project IDs we track is duplicated in:
- `scripts/sync-redmine.js` (`APPROVED_PROJECT_IDS` constant)
- `scripts/sync-backfill.js` (same constant)
- `pages/api/tickets.js` (`APPROVED_REDMINE_IDS` array — used as filter)
- `scripts/cleanup-before-oct1.js` (same IDs)

If you change the set, update **all four**. We have not consolidated to a
shared constant yet (each file needs standalone require semantics to keep
serverless cold-start happy).

## Delivery Owner = per-ticket Manager
"Delivery Owner" (Redmine custom field id **25**) is an **enumeration** field,
not a User field. Its values are internal enum IDs scoped to this field — NOT
Redmine user IDs. Mapping enum → Neon user happens at sync time by matching
the enum's `label` to `users.name`. See `buildDeliveryOwnerEnumMap()` in
`scripts/sync-redmine.js` / `scripts/sync-backfill.js`.

Resolved IDs are stored in `issues.delivery_owner_ids INTEGER[]`. Queries that
need the "Manager" column should unnest this array — see `pages/api/tickets.js`
and `pages/api/pm-pulse/executive-snapshot.js` for the pattern.

## Telegram sending
Use `sendTelegramMessage(chatId, text, { parseMode })` from `lib/telegram.js`.
Do NOT inline `fetch('https://api.telegram.org/bot...')` in new code — the
helper reads `TELEGRAM_BOT_TOKEN` from env and handles the missing-token case.

## Profile, password management, notifications
- **Sidebar avatar** opens `ProfilePanel` (slide-in from right).
- **Change password** (logged in): `POST /api/auth/change-password`
- **Forgot password** (logged out): 4-step flow at `/forgot-password`,
  endpoints under `pages/api/auth/forgot-password/`. Uses Telegram and/or
  email, falling back gracefully. Backed by `password_reset_tokens` table.
- **Notification channels**: `dashboard_users.notification_channels TEXT[]`
  (values `'telegram'` and/or `'email'`). Users toggle in their profile.

## Module system (important when adding files)
- **CommonJS** (`require` / `module.exports`) in `lib/`, `bots/`, `crons/`, and
  migration scripts. When adding a new module in those dirs, match neighbours.
- **ESM** (`import`/`export`) in `pages/api/**` (Next.js default) and
  **required** in `tests/unit/**/*.test.js` — vitest 1.x cannot be imported
  via `require`. Relative imports inside test files must include the `.js`
  extension.

## Testing
- **Unit tests** live in `tests/unit/*.test.js`. Run with `npm run test:unit`
  (or `npm run test:unit:watch`). Tests may mock CJS modules with
  `vi.spyOn(require('../../lib/foo.js'), 'fnName').mockImplementation(...)`
  combined with ESM `import` for the module under test.
- **E2E tests** (Playwright): `npm run test:e2e:smoke` (fast) or
  `npm run test:e2e:critical`. Don't remove the `test:e2e*` scripts from
  `package.json` when adding new test tooling.
- Before merging any branch that touches shared `lib/` modules, run
  `npm run test:unit`. If a file you changed has no unit test yet and is pure
  logic (no network, no DB), consider adding one.
- **CJS mocking caveat**: `vi.mock()` does NOT intercept CJS modules that
  were already `require()`-d at import time with env-dependent init
  (e.g., `lib/db.js`, `lib/redis.js`). Tests for these modules need a
  vitest setup file to set env vars before module load.

## Intimation Relay (Phase 1 — shipped Apr 2026)
Cross-user Telegram relay so managers/TLs can nudge a developer about a
ticket and have responses relayed back. Implemented in:
- `lib/intimation-relay.js` — state machine (create / log event / transition
  / send / relay / permission matrix).
- `lib/commitments.js` — AI extraction + storage of dev commitments.
- `bots/telegram/handlers/intimation.js` — callback handler.
- `crons/intimation-followup.js`, `crons/commitment-followup.js`,
  `crons/chat-enrichment.js` — dispatched by `pages/api/cron/phase1-tick.js`
  every 15 min.
- AI tools: `propose_intimation`, `extract_commitment` in `lib/gpt-tools.js`.

Conventions introduced:
- **Callback prefix `int:*`** reserved for intimation buttons. Any new
  button in this feature must use this namespace.
- **Developer role** — `dashboard_users.role = 'developer'` users are
  reply-only in Phase 1 (can respond to intimations, cannot query the bot
  freely yet). Must pass the consent gate (`/agree`) before replies relay.
- **Tool result intercept pattern** — when an AI tool returns
  `{ confirm_required: true, preview: {...} }`, the bot intercepts in
  `bots/telegram/index.js` and renders an inline-keyboard card itself; the AI
  does not produce text for that tool call. Use this pattern for any other
  future "confirm before doing" tool.

Design: `docs/superpowers/specs/2026-04-22-intimation-relay-design.md`
Plan: `docs/superpowers/plans/2026-04-22-intimation-relay.md`

## Phase roadmap
- **Phase 1 (shipped):** Intimation Relay + personalization data pipeline
  (this branch).
- **Phase 2 (planned):** Passive profile learning + training flywheel — read
  from `chat_history.intent` / `entities` to build per-user profile cards.
- **Phase 3 (planned):** Active personalization signals — pattern-based
  proactive sends.
- **Phase 4 (planned):** Cross-user intelligence for managers (with consent).

Each future phase gets its own spec + plan under `docs/superpowers/`.

## Deploy workflow
1. Make + verify changes on localhost.
2. `git commit` then `git push origin master`.
3. Vercel auto-deploys. If the production target drifts (preview instead of
   prod), check Vercel → Settings → Git → Production Branch is `master`, or
   promote the preview manually.

## Things not to do
- Don't create new `sendTelegramMessage` copies — use the lib. (Phase 1's
  `tgSend` helpers in `lib/intimation-relay.js`, `crons/intimation-followup.js`,
  and `crons/commitment-followup.js` pre-date this rule and should be
  refactored to `lib/telegram.js` in a follow-up pass.)
- Don't store raw `thinking-code.com` emails — always normalize.
- Don't filter "no time log" counts without the engineering-team whitelist.
- Don't treat Delivery Owner values as Redmine user IDs.
- Don't skip bcrypt when touching `dashboard_users.password_hash`.
- Don't add entries to `vercel.json` casually — Hobby plan caps cron count.
  Prefer routing new crons through `pages/api/cron/run.js` (`JOB_MAP`) when
  possible.
- Don't use `require('vitest')` in test files — it throws. Use ESM `import`
  and include the `.js` extension on relative paths.
- Don't expose `err.message` in API responses — use `send500()` from
  `lib/api-error.js` which logs internally and returns a generic error.
- Don't use `req.query.secret` for cron auth — use `CRON_SECRET` header
  only. Query-string secrets leak in server logs.
- Don't add DB column references without checking migration files — column
  names can drift when migrations rename them (e.g., `redmine_project_id`
  vs `redmine_id`).
