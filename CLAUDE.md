# CLAUDE.md — Redmine CEO Dashboard
# Company: ThinkingCode | Project: Internal Executive Dashboard

> **Self-learning instructions for Claude:**
> Update this file whenever you learn new facts about the project, business rules, thresholds,
> team structure, or decisions made. Keep it current. Never leave stale data — if something
> changes, edit the relevant section. This is your long-term memory for this project.

---

## Project Overview

Executive dashboard for ThinkingCode leadership to monitor team workload, project health,
ticket status, and time-log compliance — via a web UI and a Telegram bot.

**Two interfaces:**
1. Web dashboard (Next.js, dark UI) — for CEO/admin at desk
2. Telegram bot (long-polling) — on-the-go, AI chat, commands, inline buttons

---

## Company Context

- **Company:** ThinkingCode (software development firm)
- **CEO/Admin:** Upendra Prasad
- **Admin email:** upendra.prasad@thinking-code.com
- **Notification sender:** icanbefitter@gmail.com (Gmail SMTP)
- **Timezone:** IST (Asia/Kolkata, UTC+5:30)
- **Working days:** Mon–Sat (confirm if this changes)
- **Expected daily hours per person:** 8
- **Redmine URL:** https://redmine.thinkingcode.com/ (trailing slash present in env)

---

## Teams

Exact team names as stored in the `users.team` column:

| Team | Description |
|------|-------------|
| AI | AI/ML engineers |
| DB | Database team |
| QA | Quality assurance |
| Java | Java backend developers |
| JS/UI | Frontend / JavaScript |
| DevOps | Infrastructure & deployment |
| Misc | Others / uncategorized |

> If a new team appears in Redmine, update this table.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (Pages Router) |
| Frontend | React 18, custom dark CSS, Barlow font |
| Database | Neon PostgreSQL (serverless) |
| AI | Cerebras `qwen-3-235b-a22b-instruct-2507` (3 fallback keys) |
| Bot | node-telegram-bot-api (long-polling) |
| Email | Nodemailer via Gmail SMTP |
| Voice STT | Groq Whisper (optional, key not set yet) |
| Deployment | Vercel (planned — not fully set up yet) |
| Cron | Vercel cron (1 AM daily full sync) + cron-job.org (deferred) |

---

## Environment Variables

All in `.env.local`. **Never commit real values.**

```
DATABASE_URL            Neon PostgreSQL connection string
REDMINE_URL             https://redmine.thinkingcode.com/
REDMINE_API_KEY         Redmine API token
DASHBOARD_PASSWORD      Web dashboard login password
SESSION_SECRET          Cookie signing secret
SYNC_SECRET             Shared secret for /api/sync endpoint (currently "your_secret_here" — needs to be changed)
TELEGRAM_BOT_TOKEN      Telegram bot token
CEREBRAS_API_KEY        Primary Cerebras key
CEREBRAS_API_KEY_2      Fallback Cerebras key #2
CEREBRAS_API_KEY_3      Fallback Cerebras key #3
ANTHROPIC_API_KEY       (optional, not set)
GROQ_API_KEY            (optional, not set — for voice-to-text)
EMAIL_HOST              smtp.gmail.com
EMAIL_PORT              587
EMAIL_USER              icanbefitter@gmail.com
EMAIL_PASS              Gmail app password
EMAIL_FROM              ThinkingCode Personal AI <upendra.prasad@thinking-code.com>
```

---

## Database Schema (Key Tables)

```
users             — team members, telegram_chat_id, is_team_lead
projects          — name, status, deadline, progress_pct, risk, manager_id
issues            — title, status, priority, assigned_to_id, due_date, done_ratio, closed_at
issue_journals    — comments/updates on tickets
time_entries      — hours per user per day (spent_on DATE)
leave_records     — Annual/Sick/Unpaid/Maternity/Other, start/end dates
issue_team_history — which teams touched each issue
sync_log          — last sync timestamps per entity
telegram_sessions — bot conversation state machine (chat_id, state, context)
```

**Views:** `daily_time_status`, `team_workload`, `person_performance`

**Note:** Issues table stores CURRENT state only — no historical snapshots.
`daily_snapshots` table is planned but not yet created.

---

## Anomaly Detection Thresholds (Planned)

> These are defaults. Update when Upendra confirms or changes them.

| Alert | Trigger |
|-------|---------|
| Burnout risk | >15 open tickets AND <4 hrs logged in last 3 working days |
| Blocked ticket rotting | "Blocked" status for >3 days with no journal update |
| Project stall | done_ratio unchanged for 7 days on active project |
| Overdue spike | >20% of team's tickets are overdue |
| Ghost developer | Active user, no time logged for 2 working days |
| Critical unassigned | Urgent/Immediate ticket unassigned >4 hours |
| Velocity drop | Tickets closed this week < 50% of last week |

---

## AI Chat System

- **Engine:** Cerebras with 3 auto-fallback keys
- **Model:** `qwen-3-235b-a22b-instruct-2507`
- **Tools available (7):** query_dashboard, query_tickets, query_people, query_projects,
  query_timelogs, query_comparative, run_sql
- **Response limit:** 15 lines (Telegram-friendly)
- **Conversation memory:** In-memory Map per chat_id, 30-min TTL, last 20 messages kept
  → DB persistence planned but not yet built

---

## Telegram Bot

- **File:** `scripts/telegram-bot.js`
- **Run:** `node scripts/telegram-bot.js` (long-polling, runs continuously)
- **Registration:** Users type `/start`, search by name, select from inline buttons
- **Leave types:** Annual, Sick, Unpaid, Maternity, Other
- **Commands:** /pulse, /mytickets, /overdue, /blockers, /projects, /status, /report,
  /myteam, /workload, /nolog, /whoisout, /leave, /myleave, /approve, /add_user

---

## Planned Features Backlog

Track progress here. Update status as features are built.

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Delta/incremental Redmine sync | ✅ Done | lib/sync-engine.js, cron-job.org registered |
| 2 | AI anomaly alerts | ✅ Done | lib/anomaly-detector.js, pages/api/cron/anomaly.js |
| 3 | Telegram inline keyboard buttons | ✅ Done | Full rollout across all commands |
| 4 | Dashboard charts & visualizations | ✅ Done | Recharts: workload bar, ticket donut, time logs bar |
| 5 | Mobile responsive web dashboard | ✅ Done | Hamburger nav, responsive grids, slide-in sidebar |
| 6 | AI conversation memory (DB-persisted) | ✅ Done | conversation_history table, hybrid cache+DB |
| 7 | CSV export reports | ✅ Done | pages/api/export.js — tickets/timelogs/people/overview |
| 8 | Daily snapshots table | ✅ Done | daily_snapshots table, scripts/snapshot-runner.js |
| 9 | Multi-role login | ⏸ Deferred | MVP: single password login only |
| 10 | Slack integration | ⏸ Deferred | Telegram first |

**Build order:** 8 (snapshots) → 6 (conversation memory) → 3 (inline buttons) → 1 (delta sync) → 2 (anomaly alerts) → 4+5 (UI) → 7 (export)

---

## Pending Actions / Reminders

- [ ] **SYNC_SECRET** in `.env.local` is still `"your_secret_here"` — needs a real value before going to production
- [ ] **Vercel deployment** — not fully set up yet. When deploying, set up cron-job.org to hit `/api/sync` every 10 min (POST with `x-sync-secret` header). Remind Upendra.
- [ ] **GROQ_API_KEY** — not set. Needed for voice-to-text in Telegram bot.
- [ ] Confirm working days: Mon–Sat or Mon–Fri?
- [ ] Get CEO's Telegram user ID (numeric) for admin-only commands

---

## Key File Locations

```
pages/index.js              Main dashboard entry
pages/login.js              Login page
pages/api/overview.js       KPI data
pages/api/tickets.js        Issues endpoint
pages/api/people.js         Team members
pages/api/timelogs.js       Time logs
pages/api/sync.js           Manual/cron sync trigger
pages/api/cron/notify.js    Notification cron
lib/ai-chat.js              AI brain (Cerebras + 7 tools)
lib/db.js                   Neon DB singleton
lib/telegram.js             Telegram API wrapper
lib/mailer.js               Email sender
scripts/sync-redmine.js     Redmine data sync
scripts/telegram-bot.js     Bot process (run separately)
scripts/schema.sql          DB init script
middleware.js               Session auth (protects all routes)
vercel.json                 Cron config (1 AM daily)
tmp-*.js                    Migration scripts (safe to delete after confirming)
```

---

## Coding Conventions

- ES modules (`import/export`) throughout
- Neon tagged template literals for SQL: `` sql`SELECT...` ``
- No ORMs — raw SQL only
- Dark theme: bg `#030B15`, accent blue `#1A6EF5`
- All API routes validate method (GET/POST) and session
- Parameterized queries everywhere — no string concatenation in SQL
- Telegram messages use Markdown parse_mode, escape with `esc()` helper
