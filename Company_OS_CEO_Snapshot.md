# Company OS — What We Built

## The One-Liner

> We turned our Redmine project tracker into an **AI-powered command centre** that tells managers what's going wrong before they have to ask, and tells developers what to do before their standup.

---

## The Problem We Solved

| Before | After |
|--------|-------|
| CEO opens Redmine, clicks through 50 tickets manually | CEO opens one dashboard, sees the entire company pulse in 5 seconds |
| "Who didn't log time?" — someone runs a report, emails it, 2 hours later | One click → team-wise list with CSV export, instantly |
| PM asks "is Project X on track?" — meetings, Slack threads, guesswork | AI answers in 3 seconds with velocity data: "At current pace, you'll miss by 5 days" |
| Team lead preps for 1-on-1 by opening 10 tabs | One button: "Prepare 1-on-1" → AI generates talking points from real data |
| Blocked ticket sits for 3 days, nobody notices | System auto-detects and escalates to the right person within hours |

---

## What It Does

### 1. Smart Dashboard — Role-Aware

- 15 users, each with their own login
- Managers see the whole company. Team leads see only their team.
- 5 KPI cards on the home screen: Headcount, Leave, Yesterday's Hours, Overdue Tickets, Missing Time Logs
- Every number is clickable — drills down to names

### 2. AI Chat ("Intelligence Tab")

- Built into the dashboard — type a question, get an answer from your company data
- "Who hasn't logged time this week?" → instant answer
- "What's the status of Project iCast?" → deadline, progress %, risk, blockers
- "Prepare 1-on-1 with Ravi" → bullet-point talking points generated from his ticket history, hours, and blockers
- Works on Telegram too — managers can query from their phone

### 3. Automated Daily Operations

- **9:00 AM**: Developers get a Slack standup card with their active tickets. No meeting needed.
- **9:05 AM**: Team leads get a Telegram brief — overdue tickets, missing timelogs, blocked items.
- **9:10 AM**: CEO/managers get a company-wide morning pulse.
- **6:00 PM**: Anyone who didn't log time → their team lead gets notified.
- **Friday 4 PM**: Auto-generated weekly report delivered via Telegram + email.
- **Monday 8 AM**: Weekly pulse digest with velocity predictions.

### 4. Intelligence That Gets Smarter

- **Performance Scoring**: Every team member scored across 5 dimensions (output, speed, quality, reliability, collaboration). 0-100 score, updated nightly.
- **Team Health Score**: One number per team. Rising, stable, or declining. Instantly see which team needs attention.
- **Velocity Predictions**: AI calculates if a project will miss its deadline based on the team's actual ticket-closing speed. Not guesswork — math.
- **Capacity Tracking**: Know who's overloaded and who's free. System suggests rebalancing.
- **Escalation Engine**: Overdue 3 days? Blocked 24 hours? No timelog for 2 days? Auto-escalates to the right person.

### 5. Developer Self-Service (Slack)

- Developers can ask the Slack bot: "my overdue tickets?", "hours this week?", "my blockers?"
- Strictly scoped — they only see their own data
- Blocker reporting: one button in Slack → team lead gets notified on Telegram instantly

### 6. Intimation Relay (Telegram — shipped Apr 2026)

- From the manager's or team lead's phone: "ask Ravi about TK-1234" → two-tap Yes/Cancel card → the developer gets a Telegram message with Acknowledge / Working on it / Blocked buttons
- Developer replies (button or free text) are relayed to the originator instantly; the developer's team lead is silently CC'd so nothing happens behind their back
- Commitment tracking: if the developer writes "will close by EOD", the system remembers — and at EOD asks "Is it done?" with a one-tap response
- Auto-escalation: 4-hour gentle nudge, 24-hour close with escalate/close buttons for the originator
- Developer consent gate: every developer agrees once (`/agree`) before relay activates; they can revoke any time (`/revoke`)

---

## Architecture

```
Redmine (source of truth, read-only)
    ↓ syncs daily
Neon Database (PostgreSQL + AI vectors)
    ↓ powers
Dashboard (web) + Telegram Bot + Slack Bot
    ↓ powered by
AI (OpenRouter — swappable models, configurable from admin page)
    ↓ runs
13 Automated Jobs (daily standups, alerts, scoring, reports)
```

**No vendor lock-in.** AI provider is changeable from the admin page. Database is standard PostgreSQL. Everything runs on Vercel (serverless, auto-scaling).

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Users supported | 15 dashboard users + unlimited developers on Slack |
| AI model | Configurable (currently Nemotron 3 Super — free) |
| Automated jobs | 13 daily/weekly cron jobs |
| Database tables | 30 (15 existing + 15 new) |
| API endpoints | 28 |
| Zero manual reports | Everything auto-generated |
| Time to insight | Question → answer in 3-5 seconds |

---

## What This Means for the Business

1. **Visibility without meetings** — The CEO sees everything from a phone (Telegram) or browser. No "can someone pull me a report?"

2. **Accountability is automatic** — Missing timelogs, overdue tickets, silent projects — the system catches everything and notifies the right person. No one falls through the cracks.

3. **Decisions backed by data** — "Should we hire?" → Check capacity scores. "Is Team DB struggling?" → Check health score. "Will we make the deadline?" → Check velocity prediction.

4. **Scales without overhead** — Adding a new team member = one click in Admin. The system auto-includes them in standups, scoring, capacity tracking, and reports.

5. **AI that knows your company** — Not generic ChatGPT. This AI has your ticket data, your time logs, your team structure. It gives answers specific to your company.

---

## What's Next (Ready to Enable)

- **Microsoft Teams integration** for developers (code ready, just needs Teams app setup)
- **Complete Slack setup** (bot token saved, 2 more tokens needed)
- **Email weekly digests** to stakeholders (SMTP configured, templates ready)
- **AI model upgrade** — switch to Claude or GPT-4 from admin page for smarter responses

---

*Built with Next.js + Neon PostgreSQL + OpenRouter AI + Telegraf + Vercel. Zero Supabase. Zero vendor lock-in.*
