# Phase 1 Design: Intimation Relay + Personalization Foundations

**Date:** 2026-04-22
**Author:** Brainstormed with Upendra
**Status:** Approved for implementation planning
**Next step:** `writing-plans` skill to produce implementation plan

---

## Context

The Company OS Telegram bot (@ThinkingCodeBot) currently serves 2 registered users
(Upendra as `manager`, Vivek as `team_lead`). It answers questions on demand and
sends scheduled reports (morning briefing, Friday summary, reminders). All chat
flows are single-user — the bot talks to one person at a time.

Upendra wants to turn the bot into a cross-user relay: from his phone, he should
be able to intimate a developer about an overdue ticket, have the developer
respond on their own Telegram, and get the response relayed back. In parallel,
he wants the bot's interactions to get more personalized over time by learning
from every user's chat history.

This spec covers **Phase 1** of a 4-phase roadmap. Phase 1 builds the cross-user
relay primitive and lays personalization data foundations so later phases are
additive.

## Roadmap Context (for orientation)

| Phase | Scope | Spec |
|---|---|---|
| **1 (this spec)** | Intimation Relay + commitment capture + personalization data hooks | this doc |
| 2 | Passive profile learning + training flywheel (ideas A, E) | future |
| 3 | Active personalization signals — pattern detection, proactive sends (idea B) | future |
| 4 | Cross-user intelligence for managers (idea C) | future |

Each later phase gets its own spec. Phase 1 is designed so Phases 2–4 slot in
without schema rewrites.

## Goals

1. Let a manager or team lead intimate a developer about a Redmine ticket from
   Telegram with two taps.
2. Capture the developer's acknowledgment or reply and relay it back to the
   originator (and to a CC'd team lead when relevant).
3. Extract commitments ("will close by EOD") from developer replies and follow
   up automatically at the committed time.
4. Start enriching every chat message with structured metadata (intent,
   entities, role) so future personalization phases have a ready data source.

## Non-Goals (Deferred)

- Free-text intimations, person/project subjects (Phase 1.5)
- TL-to-TL, TL-to-manager, or developer-initiated threads (Phase 2)
- Full developer bot experience — self-scoped tools, morning briefings (Phase 2)
- Passive profile cards (Phase 2), active signals (Phase 3), cross-user
  intelligence (Phase 4)
- Urgency levels beyond "normal"

## Decisions

| # | Decision | Value |
|---|---|---|
| 1 | Phasing | Phase 1 = relay + foundations; A/B/C/E phased after |
| 2 | Initiators | managers and team_leads |
| 3 | Receivers | developers (reply-only in Phase 1) |
| 4 | Subject type | Redmine tickets only |
| 5 | Trigger | context-aware auto-offer buttons AND natural-language intent |
| 6 | Permission matrix | Manager → anyone; TL → developers in own team only |
| 7 | CC rule | When manager intimates a dev, dev's TL is silently CC'd |
| 8 | Receiver buttons | `[Acknowledge]` `[Working on it]` `[Blocked]` + free text |
| 9 | Timeout | 4h nudge, 24h auto-close with originator notified |
| 10 | Dev registration | Admin-provisioned via existing admin page |
| 11 | Privacy gate | First-message consent prompt before dev replies relay |
| 12 | Commitment capture | AI extracts `(promise_text, due_datetime)` from replies |
| 13 | Personalization | Background cron enriches `chat_history` every 15 min |
| 14 | Vercel cron budget | Consolidate via existing dispatcher (no new slots) |

## Architecture

```
+---------------------+
| Manager/TL Telegram |
+---------+-----------+
          | 1. auto-offer button OR NL intent
          v
+---------------------+     +--------------------+
|  bot (Telegraf)     |---->| propose_intimation |  AI tool
|  index.js           |     | (confirms target)  |
+---------+-----------+     +--------------------+
          | 2. [Yes] confirmed
          v
+---------------------+     +--------------------+
| intimation-relay.js |---->| bot_threads        |
| (new lib)           |     | bot_thread_events  |  DB
+---------+-----------+     +--------------------+
          | 3. sendMessage(dev) + sendMessage(TL as CC)
          v
+---------------------+
| Developer Telegram  |  [Ack][Working][Blocked] + free text
+---------+-----------+
          | 4. response
          v
+---------------------+     +--------------------+
|  bot (Telegraf)     |---->| extract_commitment |  AI tool
|  callback/text      |     | (if date in reply) |
+---------+-----------+     +--------------------+
          | 5. relay to originator + CC'd TL
          v
+---------------------+
| Originator Telegram |
+---------------------+

+-----------------------------+
| cron: intimation-followup   | — timeouts, nudges, close
| cron: commitment-followup   | — "did you close X as promised?"
| cron: chat-enrichment       | — tags chat_history rows
+-----------------------------+
```

All three crons are invoked by the existing
[pages/api/cron/run.js](../../../pages/api/cron/run.js) dispatcher rather than
registered as separate Vercel crons, to stay within the Hobby-plan cron budget
(see commit 09d702a for prior context on this constraint).

## Data Model

New tables (existing: `dashboard_users`, `users`, `issues`, `chat_history`):

```sql
-- Relay threads
CREATE TABLE bot_threads (
  id            SERIAL PRIMARY KEY,
  originator_id INT NOT NULL REFERENCES dashboard_users(id),
  target_id     INT NOT NULL REFERENCES dashboard_users(id),
  cc_user_id    INT REFERENCES dashboard_users(id),       -- TL when manager->dev
  issue_id      INT NOT NULL REFERENCES issues(id),
  status        TEXT NOT NULL,  -- sent|acked|replied|closed|no_response|timeout_nudged
  urgency       TEXT DEFAULT 'normal',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_event_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

CREATE INDEX idx_bot_threads_target_open
  ON bot_threads(target_id, status)
  WHERE status NOT IN ('closed', 'no_response');

CREATE INDEX idx_bot_threads_pending_followup
  ON bot_threads(last_event_at)
  WHERE status IN ('sent', 'timeout_nudged');

-- Event log (append-only)
CREATE TABLE bot_thread_events (
  id         SERIAL PRIMARY KEY,
  thread_id  INT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
  actor_id   INT REFERENCES dashboard_users(id),
  event_type TEXT NOT NULL,  -- sent|acked|button_reply|text_reply|nudged|closed|relayed_to_originator
  payload    JSONB,          -- { button: 'blocked', text: '...', telegram_msg_id: ... }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bot_thread_events_thread ON bot_thread_events(thread_id, created_at);

-- Commitments extracted from dev replies
CREATE TABLE commitments (
  id           SERIAL PRIMARY KEY,
  thread_id    INT REFERENCES bot_threads(id),
  user_id      INT NOT NULL REFERENCES dashboard_users(id),
  issue_id     INT REFERENCES issues(id),
  promise_text TEXT NOT NULL,
  due_at       TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending|kept|missed|followed_up
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX idx_commitments_due_pending
  ON commitments(due_at)
  WHERE status = 'pending';

-- Consent column added to dashboard_users
ALTER TABLE dashboard_users ADD COLUMN consent_given_at TIMESTAMPTZ;

-- Enrichment columns added to chat_history
ALTER TABLE chat_history ADD COLUMN intent       TEXT;
ALTER TABLE chat_history ADD COLUMN entities     JSONB;   -- { tickets: [], users: [], projects: [] }
ALTER TABLE chat_history ADD COLUMN role_at_time TEXT;
ALTER TABLE chat_history ADD COLUMN enriched_at  TIMESTAMPTZ;

CREATE INDEX idx_chat_history_unenriched
  ON chat_history(created_at)
  WHERE enriched_at IS NULL;
```

### Schema notes

- `bot_threads.cc_user_id` is nullable; only set when a manager intimates a dev
  and that dev has a team lead.
- `bot_thread_events` is append-only; thread state transitions are derived by
  updating `bot_threads.status` when events are written.
- `commitments.due_at` is always set on insert; rows with `status='pending'` are
  the cron's work queue.
- `chat_history.role_at_time` snapshots the user's role at message time so later
  analysis is not confused by role changes.

## Flow 1: Auto-Offer Intimation

1. Manager asks "show overdue tickets in Project X." Existing tool
   `get_overdue_tickets` runs and returns rows.
2. When the bot renders a ticket row that is overdue or blocked, it attaches an
   inline keyboard with `[Intimate <assignee_first_name>]` and, if the assignee
   has a team lead, `[Intimate TL]`.
3. Manager taps `[Intimate Ravi]` on TK-123.
4. Bot replies with a preview card: "Send this to Ravi?\n\nTK-123 'Fix login
   bug' — overdue 3 days. Upendra is asking for status." with buttons
   `[Yes, send]` `[Cancel]`.
5. Manager taps `[Yes, send]`.
6. `bot_threads` row created (`status='sent'`). `bot_thread_events` logs
   `sent`.
7. Bot sends to Ravi: "Hi Ravi, Upendra is asking about TK-123 'Fix login bug'
   (overdue 3d). Can you share status?" with buttons `[Acknowledge]`
   `[Working on it]` `[Blocked]`.
8. If Ravi has a team lead distinct from the originator, bot CCs the TL with:
   "FYI: Upendra intimated Ravi about TK-123. I'll relay the response back."
9. Bot confirms to the originator: "✓ Sent to Ravi. I'll notify you when he
   responds."

## Flow 2: Natural-Language Intimation

1. Manager types: "ask Ravi why TK-123 is overdue."
2. AI calls `propose_intimation({ target_user_hint: "Ravi", issue_id: 123,
   message: "why overdue?" })`.
3. Tool resolves "Ravi" to a `dashboard_users.id` (exact match on
   `display_name`, then case-insensitive contains). If ambiguous, tool returns
   candidates and the bot asks the user to pick.
4. On resolved target, bot renders the same preview card as Flow 1 step 4.
5. From step 5 onward, identical to Flow 1.

## Flow 3: Developer Response

1. Ravi taps `[Working on it]` on the Telegram message, or types free text
   "will close by EOD today."
2. Button tap: `bot_thread_events` logs `button_reply` with `payload.button`;
   thread status transitions to `acked`.
3. Free text: `bot_thread_events` logs `text_reply` with `payload.text`; thread
   status transitions to `replied`.
4. For free text replies, AI calls `extract_commitment({ text, now,
   issue_id })`. If it returns a due datetime, a `commitments` row is created.
5. Bot relays to originator: "Ravi replied on TK-123: 'will close by EOD
   today.' [View thread]".
6. If the thread has a CC'd TL, the CC gets the same relay message.
7. `bot_thread_events` logs `relayed_to_originator`.

### Continuation rule

Further messages from Ravi on Telegram within 2 hours of `last_event_at` are
treated as continuation of the same thread and relayed as additional
`text_reply` events. Outside that window, they are treated as ordinary bot
messages (not part of any thread).

If multiple threads are open for the same developer simultaneously, the most
recently active one receives the continuation.

## Flow 4: Timeout and Commitment Followup

- **4 hours, no ack or reply:** `intimation-followup` cron finds threads where
  `status='sent'` and `last_event_at < now - 4h`. Bot nudges the target: "Gentle
  reminder — Upendra is waiting on status for TK-123." Thread status transitions
  to `timeout_nudged`. Event logged `nudged`.
- **24 hours, no ack or reply:** Same cron finds threads where
  `status='timeout_nudged'` and `created_at < now - 24h`. Thread status
  transitions to `no_response`. Originator notified: "Ravi hasn't responded
  about TK-123 in 24h. Want to escalate? [Escalate to TL] [Close]."
- **Commitment due time reached:** `commitment-followup` cron finds rows where
  `status='pending'` and `due_at <= now`. Bot DMs the dev: "You committed TK-123
  would close by EOD — is it done? [Yes, done] [Needs more time]." Commitment
  status transitions to `followed_up`. The originator of the source thread is
  notified if the dev answers "needs more time" or doesn't reply within another
  4h.

## Permission Matrix (Phase 1)

| From ↓ / To → | Dev (own team) | Dev (other team) | TL | Manager |
|---|---|---|---|---|
| Manager | yes | yes | Phase 2 | — |
| TL | yes | no | Phase 2 | Phase 2 |
| Dev | — | — | — | — |

Enforcement lives in `propose_intimation`. Attempts that violate the matrix
return a clear error (e.g., "You can only intimate developers on your own
team").

## Personalization Foundations (A/B/C/E hooks)

Phase 1 starts the data pipeline that Phases 2–4 will consume:

- **Enrichment cron** runs every 15 min via the dispatcher. It selects up to 50
  `chat_history` rows where `enriched_at IS NULL` (oldest first), calls the AI
  once per row to tag:
  - `intent` — one of a fixed enum (`query_ticket_status`, `intimate_person`,
    `log_time`, `ask_person_summary`, `ask_project_status`, `other`).
  - `entities` — `{ tickets: [id, ...], users: [id, ...], projects: [id, ...] }`
    extracted from message text and any tool calls in the same conversation
    turn.
  - `role_at_time` — set at insert time from `dashboard_users.role`, not by the
    cron.
- Enrichment is **non-blocking** — chat flow does not wait for it. If the cron
  is down for a day, messages accumulate unenriched and are processed when it
  resumes.
- Phase 1 itself does not consume the enrichment. This is foundation work so
  that by the time Phase 2 ships, there's already weeks of enriched history to
  build profile cards from.

### Per-save enrichment

`role_at_time` is written synchronously in the chat_history insert in
[bots/telegram/index.js](../../../bots/telegram/index.js) because it's free. All
other columns remain null until the cron processes them.

## Files to Create / Modify

### New

- [lib/intimation-relay.js](../../../lib/intimation-relay.js) — core:
  create thread, send, CC, log events, state transitions.
- [lib/commitments.js](../../../lib/commitments.js) — extract and track
  commitments.
- [lib/chat-enrichment.js](../../../lib/chat-enrichment.js) — enrichment
  pipeline.
- [pages/api/cron/intimation-followup.js](../../../pages/api/cron/intimation-followup.js)
  — 4h nudge and 24h close (invoked by dispatcher).
- [pages/api/cron/commitment-followup.js](../../../pages/api/cron/commitment-followup.js)
  — commitment due-date checks (invoked by dispatcher).
- [pages/api/cron/chat-enrichment.js](../../../pages/api/cron/chat-enrichment.js)
  — enrichment cron (invoked by dispatcher).
- [bots/telegram/handlers/intimation.js](../../../bots/telegram/handlers/intimation.js)
  — callback_query handler for intimation buttons (originator confirmation,
  receiver ack buttons, escalation buttons, commitment followup buttons).
- `scripts/migrations/2026-04-22-intimation-relay.sql` — schema migration.

### Modified

- [lib/gpt-tools.js](../../../lib/gpt-tools.js) — add `propose_intimation` and
  `extract_commitment` tool definitions. Modify tools that return ticket lists
  (`get_overdue_tickets`, similar) to flag rows eligible for the intimate
  button.
- [lib/gpt-executor.js](../../../lib/gpt-executor.js) — dispatch the new tool
  names.
- [bots/telegram/index.js](../../../bots/telegram/index.js) — route inline
  keyboard clicks to the intimation handler, set `role_at_time` on chat_history
  inserts, recognize thread-continuation replies.
- [bots/telegram/prompt.js](../../../bots/telegram/prompt.js) — teach the model
  about the intimation flow and when to call `propose_intimation`.
- [bots/telegram/onboarding.js](../../../bots/telegram/onboarding.js) — add
  developer consent screen on first message.
- [pages/api/admin/telegram-setup.js](../../../pages/api/admin/telegram-setup.js)
  — allow provisioning developers (role='developer'), not just manager/TL.
- [pages/api/cron/run.js](../../../pages/api/cron/run.js) — add dispatch
  entries for the three new cron handlers.

## Vercel Cron Budget

The repo is on the Vercel Hobby plan and recently had to remove a cron to stay
under the limit (commit 09d702a). All three new crons are **invoked from the
existing `run.js` dispatcher based on the current time** rather than registered
as separate Vercel crons:

- `intimation-followup` — every dispatcher tick (cheap lookup of open threads).
- `commitment-followup` — every dispatcher tick.
- `chat-enrichment` — every dispatcher tick, capped to 50 rows per run to
  avoid AI quota spikes.

No new entries in `vercel.json`.

## Testing Approach

- **Unit — `lib/intimation-relay.js`:** state transitions (sent → acked,
  sent → replied, sent → timeout_nudged → no_response), permission checks (all
  four quadrants of the matrix), CC resolution (manager→dev with TL, manager→dev
  without TL, TL→dev).
- **Unit — `lib/commitments.js`:** datetime extraction. Test cases: "EOD",
  "EOD today", "by tomorrow 5pm", "next Monday", "in 2 hours", "end of the
  week", and negative cases ("I'll look into it" → no commitment).
- **Integration:** mocked Telegram API. Full flow from originator tap through
  developer button response and free-text response back to originator relay.
  Mocks assert the exact `telegram.sendMessage` calls and buttons rendered.
- **Manual:** end-to-end with Upendra → Vivek on the real bot before enabling
  other developers. Verify timeouts by manipulating `last_event_at` in the DB.

## Privacy and Consent

- Developer onboarding message (on their first Telegram interaction after
  admin-provisioning): "Your messages to this bot are logged and may be
  reviewed by your manager or team lead for coaching and delivery purposes.
  Reply /agree to continue."
- `dashboard_users` gets a new `consent_given_at` column (nullable). Developer
  replies relay only when `consent_given_at IS NOT NULL`.
- `/revoke` command clears `consent_given_at`. Bot stops relaying but admin is
  notified so they can follow up out-of-band.

## Open Risks

1. **AI-based commitment extraction reliability.** A missed extraction means a
   lost followup; a false-positive means nagging a dev about a commitment they
   didn't make. Mitigation: extraction confidence threshold; low-confidence
   extractions are stored but not followed up on without originator
   confirmation.
2. **Telegram rate limits.** A burst of intimations (e.g., manager intimates 10
   devs at once) could hit per-chat limits. Mitigation: queue sends at 1/sec
   per chat.
3. **Name resolution ambiguity.** "Ravi" could match multiple users.
   Mitigation: `propose_intimation` returns candidates when ambiguous; bot
   asks user to pick.
4. **Vercel function execution limits.** The dispatcher tick now does more
   work. Mitigation: each sub-handler has an internal time budget; enrichment
   is the one that caps rows-per-run.
5. **Consent is asynchronous.** Admin provisions a dev, but the dev may not
   message the bot for days. Intimations sent in that window have no one to
   deliver to. Mitigation: `propose_intimation` checks target has
   `consent_given_at` and `telegram_id` before creating the thread; returns a
   clear error if not.

## Definition of Done

- Manager on Telegram can tap an intimate button on an overdue ticket, confirm,
  and the developer receives the message on their Telegram with response
  buttons.
- Developer's button tap or free-text reply is relayed to the originator (and
  CC'd TL where applicable) within 30 seconds.
- A commitment ("will close by EOD") in a free-text reply produces a row in
  `commitments` and triggers a followup DM at the committed time.
- Unanswered threads are nudged at 4h and closed at 24h with originator
  notified.
- Every new message in `chat_history` has `role_at_time` populated
  synchronously; enrichment cron backfills `intent` and `entities` within 30
  minutes.
- Developer consent gate works: pre-consent, replies are not relayed;
  post-`/agree`, they are.
- All unit and integration tests pass. Manual e2e with Upendra → Vivek
  successful.
