# Redmine CEO Dashboard

Executive dashboard for engineering managers and team leads — pulls data from Redmine into a Postgres cache and surfaces role-specific views via a Next.js web app, Telegram bot, and Slack integration.

## Architecture

```
Redmine REST API ──► Sync Cron ──► Neon Postgres ◄── Next.js Dashboard
                        │                               │
                   Upstash Redis ◄── Telegram Bot ◄──────┘
                        │               │
                   OpenRouter AI ────────┘  (chat / intelligence)
```

- **Source of truth**: Redmine (project management)
- **Cache**: Neon Postgres — synced daily via `pages/api/sync.js`
- **Volatile state**: Upstash Redis — chat sessions, onboarding state
- **Bot**: Telegram (Telegraf) — manager queries, intimation relay, reminders
- **AI**: OpenRouter — natural-language querying of project data
- **Deployment**: Vercel (crons trigger sync, briefings, reminders)

## Features

### Dashboard (`pages/index.js`)
- Per-role views: Manager, Team Lead, Developer
- Ticket overview grouped by project, with overdue/blocked/review counts
- Time log summary (today, yesterday, weekly/monthly/quarterly trends)
- Team health metrics, escalation chain, pinned insights
- Sortable columns, overdue and blocked filters
- Anomaly detection flags (assignee mismatches, status inconsistencies)

### PM Pulse (`pages/api/pm-pulse/`)
- Executive snapshot — org-wide ticket distribution across managers
- Developer load — per-person ticket counts with engineering-team filter
- Anomalies — cross-checks Delivery Owner vs Assignee, stale tickets

### Telegram Bot
- `/start` — role-based onboarding (manager / team_lead / developer)
- Natural-language queries via OpenRouter AI (`"show me open tickets for AI team"`)
- **Intimation Relay** (Phase 1) — managers/TLs can nudge developers about tickets; responses relayed back
- Developer commitments — AI extracts and stores promises from conversations
- Scheduled briefings — morning summary (cron), Friday weekly report, missing-log reminders

### Slack Integration
- Standup bot, blocker tracking, ticket queries, dev Q&A

### Admin
- User management, project configuration, Telegram setup
- Leave tracking
- AI config (model selection, tool enable/disable)
- Unknown query review dashboard

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (pages router) |
| Database | Neon Postgres (serverless) |
| Cache | Upstash Redis |
| Auth | JWT (`ceo_session` cookie) + bcrypt |
| Bot | Telegraf (Telegram), Bolt (Slack) |
| AI | OpenRouter (OpenAI GPT-4o) |
| Sync | Redmine REST API via `node-fetch` |
| Email | Nodemailer + SMTP |
| Testing | Vitest (unit), Playwright (E2E) |
| Cron | Vercel Cron Jobs (5 slots) + GitHub Actions |
| Deploy | Vercel (auto-deploy from `master`) |

## Getting Started

### Prerequisites

- Node.js 18+
- A Redmine instance with API access
- Neon Postgres project (or any Postgres 15+)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather)) — optional
- OpenRouter API key — optional

### Setup

```bash
cp .env.example .env.local
# Fill in your credentials
npm install
npm run migrate    # Run all DB migrations
npm run seed       # Create initial admin user
npm run sync       # Initial full sync from Redmine
npm run dev        # Start dev server at http://localhost:3000
```

### Environment Variables

See `.env.example` for the full list. Minimum required:

- `REDMINE_URL` / `REDMINE_API_KEY` — Redmine API access
- `DATABASE_URL` — Neon Postgres connection string
- `JWT_SECRET` — random string for session signing (>= 32 chars)
- `CRON_SECRET` — shared secret for cron endpoint auth (set in Vercel env)

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run sync` | Manual Redmine sync |
| `npm run migrate` | Run all DB migrations |
| `npm run seed` | Seed default admin user |
| `npm run test:unit` | Run unit tests (Vitest) |
| `npm run test:e2e:smoke` | Run E2E smoke tests (Playwright) |

## Project Structure

```
├── pages/
│   ├── index.js              # Main dashboard
│   ├── login.js              # Auth page
│   ├── forgot-password.js    # Password reset flow
│   ├── _app.js               # App wrapper
│   └── api/
│       ├── sync.js           # Daily Redmine sync endpoint
│       ├── overview.js       # Dashboard data API
│       ├── tickets.js        # Ticket listing + filtering
│       ├── timelogs.js       # Time log summaries
│       ├── pm-pulse/         # PM Pulse analytics
│       ├── cron/             # Scheduled jobs (briefings, reminders)
│       ├── auth/             # Login, password change, forgot-password
│       └── telegram/         # Telegram webhook handler
├── components/               # React components (Dashboard, ProfilePanel, etc.)
├── lib/                      # Shared libraries (db, auth, ai, telegram, etc.)
├── bots/
│   ├── telegram/             # Telegram bot (handlers, prompts, onboarding)
│   └── slack/                # Slack bot integration
├── crons/                    # Cron job modules (briefings, intimation, etc.)
├── scripts/
│   ├── sync-redmine.js       # Standalone Redmine sync
│   ├── sync-backfill.js      # One-time backfill
│   ├── migrate.js            # Migration runner (with _schema_migrations tracking)
│   ├── migrations/           # SQL migration files (001-023)
│   └── seed-admin.js         # Admin user seeder
├── tests/
│   ├── unit/                 # Vitest unit tests (10 files, 124 tests)
│   └── e2e/                  # Playwright E2E tests
└── intelligence/             # AI module (learning, matcher, reports, etc.)
```

## Deployment

1. Push to `master` — Vercel auto-deploys
2. Configure env vars in Vercel dashboard
3. Run `npm run migrate` and `npm run seed` against the production DB
4. Vercel Cron handles daily sync and scheduled briefings

The Hobby plan supports 5 cron slots. Current usage:
- Daily Redmine sync (`/api/sync`) — 1:00 AM (uses `CRON_SECRET` header)
- Morning briefing (`/api/cron/morning-briefing`) — 3:30 AM
- Missing-log reminder (`/api/cron/missing-log-reminder`) — 11:30 AM weekdays
- Friday summary (`/api/cron/friday-summary`) — 1:30 PM Friday
- Weekly learning layer (`/api/cron/learning-layer`) — 8:30 PM Sunday

All cron endpoints require the `CRON_SECRET` header for authentication.

## Security

- JWT auth with bcrypt password hashing
- Rate limiting on login (10 req/min sliding window, Upstash Redis)
- SSRF protection on sync-leave endpoint
- Slack signature verification on all events
- Cron auth via `CRON_SECRET` header (query-string secrets rejected)
- API errors sanitized — no internal error messages exposed to clients
- Security headers: HSTS, nosniff, DENY frame, referrer-policy

## License

Private — internal use at Thinking Code
