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
- **Production branch**: `master`. Push to master → Vercel auto-deploys.

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

## Deploy workflow
1. Make + verify changes on localhost.
2. `git commit` then `git push origin master`.
3. Vercel auto-deploys. If the production target drifts (preview instead of
   prod), check Vercel → Settings → Git → Production Branch is `master`, or
   promote the preview manually.

## Things not to do
- Don't create new `sendTelegramMessage` copies — use the lib.
- Don't store raw `thinking-code.com` emails — always normalize.
- Don't filter "no time log" counts without the engineering-team whitelist.
- Don't treat Delivery Owner values as Redmine user IDs.
- Don't skip bcrypt when touching `dashboard_users.password_hash`.
