# Intimation Relay + Personalization Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-user Telegram relay that lets managers/TLs intimate developers about Redmine tickets with Yes/No buttons, tracks acks/replies, captures "will close by EOD"-style commitments, and starts enriching every chat message with metadata for future personalization phases.

**Architecture:** New `lib/intimation-relay.js` state machine backed by `bot_threads` + `bot_thread_events` tables. Receiver responses (button taps or free text) flow through a new callback-query handler (`bots/telegram/handlers/intimation.js`) and are relayed to originator + CC'd TL. AI tools `propose_intimation` (originator side) and `extract_commitment` (receiver-reply side) integrate with the existing Telegraf bot pipeline. Three background jobs (timeouts, commitments, enrichment) run via a single new Vercel cron slot that dispatches to all three.

**Tech Stack:** Node.js (CommonJS in `lib/`, `crons/`, `bots/`; ESM in `pages/api/`), Next.js 16, Postgres via `@neondatabase/serverless` (tagged template literals), Telegraf 4, `lib/ai.js` (Cerebras primary / OpenRouter fallback), Upstash Redis. **Vitest** is introduced in Task 1 as the unit test framework (the repo previously had Playwright only).

**Reference spec:** [docs/superpowers/specs/2026-04-22-intimation-relay-design.md](../specs/2026-04-22-intimation-relay-design.md)

---

## File Map

### New files
- `scripts/migrations/019-intimation-relay.sql` — schema
- `lib/intimation-relay.js` — state machine (create, transition, send, CC)
- `lib/commitments.js` — extract + track commitments
- `lib/chat-enrichment.js` — enrichment pipeline
- `bots/telegram/handlers/intimation.js` — callback_query handler (prefix `int:`)
- `crons/intimation-followup.js` — 4h nudge + 24h close job
- `crons/commitment-followup.js` — commitment due check
- `crons/chat-enrichment.js` — batch enrichment job
- `pages/api/cron/phase1-tick.js` — single Vercel entry that invokes all three jobs
- `tests/unit/intimation-relay.test.js` — state transition + permission tests
- `tests/unit/commitments.test.js` — AI date extraction tests
- `vitest.config.js` — test framework config

### Modified files
- `package.json` — add `vitest`, add `test:unit` script
- `lib/roles.js` — add `developer` role
- `lib/gpt-tools.js` — add `propose_intimation` and `extract_commitment` tool defs; flag ticket rows for intimate buttons
- `lib/gpt-executor.js` — dispatch new tools
- `bots/telegram/index.js` — route `int:` callbacks, add `role_at_time` on chat_history insert, thread-continuation routing
- `bots/telegram/prompt.js` — teach intimation flow
- `bots/telegram/onboarding.js` — developer consent screen + `/agree` + `/revoke`
- `vercel.json` — add one entry for `phase1-tick`

---

## Task 0: Preflight — read the spec

- [ ] **Step 1: Read the design spec end-to-end**

Open [docs/superpowers/specs/2026-04-22-intimation-relay-design.md](../specs/2026-04-22-intimation-relay-design.md) and skim every section. The spec is the source of truth; this plan implements it.

- [ ] **Step 2: Verify DB connection**

Run: `node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); getDb()\`SELECT 1 AS ok\`.then(r => console.log(r))"`

Expected: `[ { ok: 1 } ]`. If this fails, stop and fix `.env.local` / `DATABASE_URL`.

- [ ] **Step 3: Confirm current dashboard_users role values**

Run: `node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); getDb()\`SELECT role, COUNT(*) FROM dashboard_users GROUP BY role\`.then(r => console.log(r))"`

Expected: rows showing `manager` and `team_lead`. If you see `developer` already, flag that the spec's assumption (devs not yet onboarded) is out of date.

---

## Task 1: Set up Vitest

**Files:**
- Create: `vitest.config.js`
- Modify: `package.json`
- Create: `tests/unit/.gitkeep`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest@^1.6.0
```

- [ ] **Step 2: Create `vitest.config.js`**

```javascript
// vitest.config.js
module.exports = {
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
  },
};
```

- [ ] **Step 3: Add test script to `package.json`**

In the `"scripts"` block, add after `"test:e2e:headed"`:

```json
"test:unit": "vitest run",
"test:unit:watch": "vitest"
```

- [ ] **Step 4: Create placeholder so directory exists**

```bash
mkdir -p tests/unit && touch tests/unit/.gitkeep
```

- [ ] **Step 5: Smoke-test the framework**

Create `tests/unit/smoke.test.js`:

```javascript
const { describe, it, expect } = require('vitest');

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm run test:unit`
Expected: `1 passed`. Delete `tests/unit/smoke.test.js` after verifying.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.js tests/unit/.gitkeep
git commit -m "chore: add vitest for unit testing"
```

---

## Task 2: Database migration

**Files:**
- Create: `scripts/migrations/019-intimation-relay.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- scripts/migrations/019-intimation-relay.sql
-- Phase 1: Intimation Relay + Personalization Foundations
-- Note: no BEGIN/COMMIT — scripts/migrate.js splits on ';' and runs statements
-- one by one against Neon. Each DDL auto-commits; IF NOT EXISTS guards re-runs.

-- Consent column on dashboard_users
ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;

-- Relay threads
CREATE TABLE IF NOT EXISTS bot_threads (
  id            SERIAL PRIMARY KEY,
  originator_id INT NOT NULL REFERENCES dashboard_users(id),
  target_id     INT NOT NULL REFERENCES dashboard_users(id),
  cc_user_id    INT REFERENCES dashboard_users(id),
  issue_id      INT NOT NULL REFERENCES issues(id),
  status        TEXT NOT NULL CHECK (status IN (
                  'sent','acked','replied','timeout_nudged','no_response','closed'
                )),
  urgency       TEXT NOT NULL DEFAULT 'normal',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_threads_target_open
  ON bot_threads(target_id, status)
  WHERE status NOT IN ('closed', 'no_response');

CREATE INDEX IF NOT EXISTS idx_bot_threads_pending_followup
  ON bot_threads(last_event_at)
  WHERE status IN ('sent', 'timeout_nudged');

-- Event log
CREATE TABLE IF NOT EXISTS bot_thread_events (
  id         SERIAL PRIMARY KEY,
  thread_id  INT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
  actor_id   INT REFERENCES dashboard_users(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
                'sent','acked','button_reply','text_reply','nudged',
                'closed','relayed_to_originator'
              )),
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_thread_events_thread
  ON bot_thread_events(thread_id, created_at);

-- Commitments extracted from dev replies
CREATE TABLE IF NOT EXISTS commitments (
  id           SERIAL PRIMARY KEY,
  thread_id    INT REFERENCES bot_threads(id),
  user_id      INT NOT NULL REFERENCES dashboard_users(id),
  issue_id     INT REFERENCES issues(id),
  promise_text TEXT NOT NULL,
  due_at       TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','kept','missed','followed_up')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commitments_due_pending
  ON commitments(due_at)
  WHERE status = 'pending';

-- Enrichment columns on chat_history
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS intent       TEXT;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS entities     JSONB;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS role_at_time TEXT;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS enriched_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_history_unenriched
  ON chat_history(created_at)
  WHERE enriched_at IS NULL;
```

- [ ] **Step 2: Run the migration**

```bash
npm run migrate
```

Expected: `scripts/migrate.js` picks up `019-intimation-relay.sql` automatically (runs all migrations in order, statements split on `;`). Output logs each statement. Because every DDL uses `IF NOT EXISTS`, re-running is safe.

If this fails with a DB connectivity error, run directly with psql:
`psql "$DATABASE_URL" -f scripts/migrations/019-intimation-relay.sql`

- [ ] **Step 3: Verify tables exist**

```bash
node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); const sql=getDb(); sql\`SELECT table_name FROM information_schema.tables WHERE table_name IN ('bot_threads','bot_thread_events','commitments') ORDER BY table_name\`.then(r=>console.log(r))"
```

Expected: three rows — `bot_thread_events`, `bot_threads`, `commitments`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/019-intimation-relay.sql
git commit -m "feat(db): migration for intimation relay + personalization columns"
```

---

## Task 3: Add `developer` role

**Files:**
- Modify: `lib/roles.js`

- [ ] **Step 1: Read current `lib/roles.js`**

Open [lib/roles.js](../../../lib/roles.js) and note the `ROLES` object has two keys: `manager`, `team_lead`.

- [ ] **Step 2: Add `developer` role**

Edit `lib/roles.js` — inside the `ROLES` object, add after the `team_lead` block:

```javascript
  developer: {
    label: 'Developer',
    canSeeAllTeams: false,
    canSeeAllProjects: false,
    canManageUsers: false,
    canAccessAdmin: false,
  },
```

- [ ] **Step 3: Commit**

```bash
git add lib/roles.js
git commit -m "feat(roles): add developer role (reply-only in Phase 1)"
```

---

## Task 4: `lib/intimation-relay.js` — thread creation (TDD)

**Files:**
- Create: `lib/intimation-relay.js`
- Create: `tests/unit/intimation-relay.test.js`

- [ ] **Step 1: Write the failing test for `createThread`**

Create `tests/unit/intimation-relay.test.js`:

```javascript
const { describe, it, expect, vi, beforeEach } = require('vitest');

// Mock DB before importing module under test
const mockSql = vi.fn();
vi.mock('../../lib/db', () => ({
  getDb: () => mockSql,
}));

const { createThread } = require('../../lib/intimation-relay');

describe('createThread', () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it('inserts a bot_threads row and a sent event, returns thread id', async () => {
    // First call: INSERT into bot_threads RETURNING id
    // Second call: INSERT into bot_thread_events
    mockSql
      .mockResolvedValueOnce([{ id: 42 }])
      .mockResolvedValueOnce([]);

    const id = await createThread({
      originator_id: 1,
      target_id: 2,
      cc_user_id: null,
      issue_id: 100,
    });

    expect(id).toBe(42);
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm run test:unit
```

Expected: test fails because `lib/intimation-relay.js` does not exist (Cannot find module).

- [ ] **Step 3: Implement `createThread`**

Create `lib/intimation-relay.js`:

```javascript
/**
 * lib/intimation-relay.js
 * Core state machine for Intimation Relay (Phase 1).
 * Threads are created by originators (manager/TL), sent to targets (developer),
 * and move through sent -> acked/replied -> closed states via explicit events.
 */

const { getDb } = require('./db');

async function createThread({ originator_id, target_id, cc_user_id = null, issue_id, urgency = 'normal' }) {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO bot_threads (originator_id, target_id, cc_user_id, issue_id, status, urgency)
    VALUES (${originator_id}, ${target_id}, ${cc_user_id}, ${issue_id}, 'sent', ${urgency})
    RETURNING id
  `;
  const id = rows[0].id;
  await sql`
    INSERT INTO bot_thread_events (thread_id, actor_id, event_type, payload)
    VALUES (${id}, ${originator_id}, 'sent', ${JSON.stringify({})}::jsonb)
  `;
  return id;
}

module.exports = { createThread };
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm run test:unit
```

Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/intimation-relay.js tests/unit/intimation-relay.test.js
git commit -m "feat(relay): createThread writes bot_threads row and sent event"
```

---

## Task 5: `lib/intimation-relay.js` — state transitions

**Files:**
- Modify: `lib/intimation-relay.js`
- Modify: `tests/unit/intimation-relay.test.js`

- [ ] **Step 1: Write failing tests for `logEvent` and `transitionStatus`**

Append to `tests/unit/intimation-relay.test.js`:

```javascript
const { logEvent, transitionStatus, getOpenThreadForTarget } = require('../../lib/intimation-relay');

describe('logEvent', () => {
  beforeEach(() => { mockSql.mockReset(); });

  it('inserts a bot_thread_events row and updates last_event_at', async () => {
    mockSql.mockResolvedValueOnce([]);  // insert event
    mockSql.mockResolvedValueOnce([]);  // update last_event_at

    await logEvent({
      thread_id: 42,
      actor_id: 7,
      event_type: 'button_reply',
      payload: { button: 'working_on_it' },
    });

    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

describe('transitionStatus', () => {
  beforeEach(() => { mockSql.mockReset(); });

  it('updates bot_threads.status and returns the new status', async () => {
    mockSql.mockResolvedValueOnce([{ status: 'acked' }]);

    const next = await transitionStatus(42, 'acked');
    expect(next).toBe('acked');
  });

  it('throws on invalid status', async () => {
    await expect(transitionStatus(42, 'bogus')).rejects.toThrow(/invalid status/i);
  });
});

describe('getOpenThreadForTarget', () => {
  beforeEach(() => { mockSql.mockReset(); });

  it('returns the most recently active open thread for a target user', async () => {
    mockSql.mockResolvedValueOnce([{ id: 99, status: 'sent', last_event_at: new Date() }]);

    const t = await getOpenThreadForTarget(5);
    expect(t.id).toBe(99);
  });

  it('returns null when no open thread exists', async () => {
    mockSql.mockResolvedValueOnce([]);
    const t = await getOpenThreadForTarget(5);
    expect(t).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests and verify failures**

```bash
npm run test:unit
```

Expected: 3 new tests fail because the functions are not exported.

- [ ] **Step 3: Implement the functions**

Append to `lib/intimation-relay.js` (before `module.exports`):

```javascript
const VALID_STATUSES = ['sent','acked','replied','timeout_nudged','no_response','closed'];

async function logEvent({ thread_id, actor_id, event_type, payload = {} }) {
  const sql = getDb();
  await sql`
    INSERT INTO bot_thread_events (thread_id, actor_id, event_type, payload)
    VALUES (${thread_id}, ${actor_id}, ${event_type}, ${JSON.stringify(payload)}::jsonb)
  `;
  await sql`
    UPDATE bot_threads
    SET last_event_at = NOW()
    WHERE id = ${thread_id}
  `;
}

async function transitionStatus(thread_id, next_status) {
  if (!VALID_STATUSES.includes(next_status)) {
    throw new Error(`invalid status: ${next_status}`);
  }
  const sql = getDb();
  const closed_at = (next_status === 'closed' || next_status === 'no_response') ? 'NOW()' : null;
  const rows = await sql`
    UPDATE bot_threads
    SET status = ${next_status},
        closed_at = CASE WHEN ${next_status} IN ('closed','no_response') THEN NOW() ELSE closed_at END
    WHERE id = ${thread_id}
    RETURNING status
  `;
  return rows[0]?.status;
}

async function getOpenThreadForTarget(target_id) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, originator_id, target_id, cc_user_id, issue_id, status, last_event_at
    FROM bot_threads
    WHERE target_id = ${target_id}
      AND status NOT IN ('closed','no_response')
    ORDER BY last_event_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}
```

Update `module.exports` at the bottom to:

```javascript
module.exports = { createThread, logEvent, transitionStatus, getOpenThreadForTarget };
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm run test:unit
```

Expected: 4 passing tests total for this file.

- [ ] **Step 5: Commit**

```bash
git add lib/intimation-relay.js tests/unit/intimation-relay.test.js
git commit -m "feat(relay): logEvent, transitionStatus, getOpenThreadForTarget"
```

---

## Task 6: `lib/intimation-relay.js` — permission checks

**Files:**
- Modify: `lib/intimation-relay.js`
- Modify: `tests/unit/intimation-relay.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/intimation-relay.test.js`:

```javascript
const { canIntimate } = require('../../lib/intimation-relay');

describe('canIntimate', () => {
  it('manager can intimate a developer on any team', () => {
    const from = { role: 'manager', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Beta' };
    expect(canIntimate(from, to).allowed).toBe(true);
  });

  it('TL can intimate a developer on their own team', () => {
    const from = { role: 'team_lead', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Alpha' };
    expect(canIntimate(from, to).allowed).toBe(true);
  });

  it('TL cannot intimate a developer on a different team', () => {
    const from = { role: 'team_lead', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Beta' };
    const r = canIntimate(from, to);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/own team/i);
  });

  it('TL cannot intimate another TL (Phase 2)', () => {
    const from = { role: 'team_lead', team: 'Alpha' };
    const to   = { role: 'team_lead', team: 'Alpha' };
    expect(canIntimate(from, to).allowed).toBe(false);
  });

  it('developer cannot initiate intimation', () => {
    const from = { role: 'developer', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Alpha' };
    expect(canIntimate(from, to).allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify failures**

```bash
npm run test:unit
```

Expected: 5 new failures.

- [ ] **Step 3: Implement `canIntimate`**

Append to `lib/intimation-relay.js` (before `module.exports`):

```javascript
/**
 * Phase 1 permission matrix:
 *   manager  -> developer (any team): allowed
 *   team_lead -> developer (own team): allowed
 *   everything else: denied
 */
function canIntimate(from, to) {
  if (!from || !to) return { allowed: false, reason: 'missing users' };
  if (from.role === 'manager' && to.role === 'developer') {
    return { allowed: true };
  }
  if (from.role === 'team_lead' && to.role === 'developer') {
    if (from.team && from.team === to.team) return { allowed: true };
    return { allowed: false, reason: 'You can only intimate developers on your own team.' };
  }
  return { allowed: false, reason: 'Phase 1 supports manager->dev and TL->own-team-dev only.' };
}
```

Update `module.exports`:

```javascript
module.exports = { createThread, logEvent, transitionStatus, getOpenThreadForTarget, canIntimate };
```

- [ ] **Step 4: Run tests and verify pass**

```bash
npm run test:unit
```

Expected: all intimation-relay tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/intimation-relay.js tests/unit/intimation-relay.test.js
git commit -m "feat(relay): canIntimate enforces Phase 1 permission matrix"
```

---

## Task 7: `lib/intimation-relay.js` — send to Telegram + CC

**Files:**
- Modify: `lib/intimation-relay.js`

- [ ] **Step 1: Add `sendIntimation` function**

Append to `lib/intimation-relay.js` (before `module.exports`):

```javascript
const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

async function tgSend(chat_id, text, reply_markup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id, text, parse_mode: 'Markdown' };
  if (reply_markup) body.reply_markup = reply_markup;
  const r = await fetch(`${TELEGRAM_API(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`);
  return data.result;
}

function receiverButtons(thread_id) {
  return {
    inline_keyboard: [
      [
        { text: 'Acknowledge', callback_data: `int:ack:${thread_id}` },
        { text: 'Working on it', callback_data: `int:working:${thread_id}` },
        { text: 'Blocked', callback_data: `int:blocked:${thread_id}` },
      ],
    ],
  };
}

/**
 * Send an intimation: delivers the message to the target and (if present) CC'd user.
 * Assumes the caller has already run canIntimate and created the thread.
 *
 * @param {object} args
 * @param {number} args.thread_id
 * @param {object} args.originator  dashboard_users row
 * @param {object} args.target      dashboard_users row (must have telegram_id + consent_given_at)
 * @param {object|null} args.cc     dashboard_users row or null
 * @param {object} args.issue       { id, redmine_id, subject, status, due_date, days_overdue }
 * @param {string} args.note        optional extra context from originator
 */
async function sendIntimation({ thread_id, originator, target, cc = null, issue, note = '' }) {
  const originatorName = originator.display_name || originator.username;
  const targetName = target.display_name || target.username;
  const ticketLink = `[TK-${issue.redmine_id}](https://redmine.thinkingcode.com/issues/${issue.redmine_id})`;
  const overdueLine = (issue.days_overdue && issue.days_overdue > 0)
    ? ` (overdue ${issue.days_overdue}d)` : '';
  const noteLine = note ? `\n\n_${note}_` : '';

  const receiverText =
    `Hi ${targetName}, *${originatorName}* is asking about ${ticketLink} '${issue.subject}'${overdueLine}. Can you share status?${noteLine}`;

  await tgSend(target.telegram_id, receiverText, receiverButtons(thread_id));

  if (cc && cc.telegram_id) {
    const ccText =
      `FYI: *${originatorName}* intimated *${targetName}* about ${ticketLink}. I'll relay the response back here.`;
    await tgSend(cc.telegram_id, ccText);
  }

  const confirmText = `✓ Sent to ${targetName}. I'll notify you when they respond.`;
  await tgSend(originator.telegram_id, confirmText);
}

/**
 * Relay a target's response back to the originator (and CC'd user, if any).
 */
async function relayResponse({ thread, originator, cc = null, responseText, buttonLabel = null }) {
  const ticketLink = `[TK-${thread.redmine_id}](https://redmine.thinkingcode.com/issues/${thread.redmine_id})`;
  const body = buttonLabel
    ? `${thread.target_display_name} on ${ticketLink}: *${buttonLabel}*`
    : `${thread.target_display_name} replied on ${ticketLink}: '${responseText}'`;

  await tgSend(originator.telegram_id, body);
  if (cc && cc.telegram_id) await tgSend(cc.telegram_id, body);
}

module.exports.sendIntimation = sendIntimation;
module.exports.relayResponse = relayResponse;
module.exports.receiverButtons = receiverButtons;
```

- [ ] **Step 2: No new unit tests for send functions**

These call live Telegram; they're covered by the manual e2e smoke test (Task 21). We explicitly choose not to mock `fetch` here because the behavior is simple pass-through.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npm run test:unit
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add lib/intimation-relay.js
git commit -m "feat(relay): sendIntimation and relayResponse with CC support"
```

---

## Task 8: `lib/commitments.js` — AI date extraction (TDD)

**Files:**
- Create: `lib/commitments.js`
- Create: `tests/unit/commitments.test.js`

- [ ] **Step 1: Write failing tests for `extractCommitment`**

Create `tests/unit/commitments.test.js`:

```javascript
const { describe, it, expect, vi, beforeEach } = require('vitest');

const mockChat = vi.fn();
vi.mock('../../lib/ai', () => ({
  chat: (...args) => mockChat(...args),
}));

const { extractCommitment } = require('../../lib/commitments');

describe('extractCommitment', () => {
  beforeEach(() => { mockChat.mockReset(); });

  it('returns null when the text has no time commitment', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ has_commitment: false }) } }],
    });
    const r = await extractCommitment({ text: "I'll look into it", now: new Date('2026-04-22T09:00:00Z') });
    expect(r).toBeNull();
  });

  it('extracts a due datetime and promise text when present', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        has_commitment: true,
        due_at: '2026-04-22T18:00:00+05:30',
        promise_text: 'will close by EOD',
      }) } }],
    });
    const r = await extractCommitment({
      text: 'will close by EOD today',
      now: new Date('2026-04-22T09:00:00Z'),
    });
    expect(r.promise_text).toBe('will close by EOD');
    expect(r.due_at).toBeInstanceOf(Date);
  });

  it('returns null when due_at is in the past', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        has_commitment: true,
        due_at: '2026-04-20T10:00:00+05:30',
        promise_text: 'yesterday',
      }) } }],
    });
    const r = await extractCommitment({
      text: 'I said I would do it yesterday',
      now: new Date('2026-04-22T09:00:00Z'),
    });
    expect(r).toBeNull();
  });

  it('returns null when AI response is not valid JSON', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json at all' } }],
    });
    const r = await extractCommitment({ text: 'whatever', now: new Date() });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests and verify failures**

```bash
npm run test:unit
```

Expected: 4 failures because `lib/commitments.js` doesn't exist.

- [ ] **Step 3: Implement `extractCommitment`**

Create `lib/commitments.js`:

```javascript
/**
 * lib/commitments.js
 * Extract and track commitments that developers make in reply to intimations.
 */

const { chat } = require('./ai');
const { getDb } = require('./db');

const EXTRACT_PROMPT = `You extract time commitments from short replies. Given a reply and the current datetime, output strict JSON:
{ "has_commitment": true|false, "due_at": "ISO8601 with timezone" (optional), "promise_text": "short phrase" (optional) }

Rules:
- Only return has_commitment=true if the reply contains a clear deadline ("EOD", "tomorrow 5pm", "by Friday", "in 2 hours", specific date/time).
- Assume timezone Asia/Kolkata (+05:30) unless the reply specifies otherwise.
- "EOD" = 18:00 local time today.
- "end of the week" = Friday 18:00 local time.
- If already past the implied time, still return the literal interpretation; the caller will filter.
- Never guess. If ambiguous, return has_commitment=false.`;

async function extractCommitment({ text, now = new Date() }) {
  const userMsg = `Current datetime: ${now.toISOString()}\nReply: "${text}"`;
  try {
    const resp = await chat([
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: userMsg },
    ]);
    const content = resp.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.has_commitment) return null;
    if (!parsed.due_at || !parsed.promise_text) return null;
    const due = new Date(parsed.due_at);
    if (isNaN(due.getTime())) return null;
    if (due.getTime() <= now.getTime()) return null;
    return { due_at: due, promise_text: String(parsed.promise_text).slice(0, 200) };
  } catch (e) {
    console.error('extractCommitment error:', e.message);
    return null;
  }
}

module.exports = { extractCommitment };
```

- [ ] **Step 4: Run tests and verify pass**

```bash
npm run test:unit
```

Expected: 4 passes for commitments.test.js.

- [ ] **Step 5: Commit**

```bash
git add lib/commitments.js tests/unit/commitments.test.js
git commit -m "feat(commitments): AI-based extraction with past-due filtering"
```

---

## Task 9: `lib/commitments.js` — storage + due lookup

**Files:**
- Modify: `lib/commitments.js`

- [ ] **Step 1: Append storage functions**

Append to `lib/commitments.js` (before `module.exports`):

```javascript
async function createCommitment({ thread_id, user_id, issue_id, promise_text, due_at }) {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO commitments (thread_id, user_id, issue_id, promise_text, due_at, status)
    VALUES (${thread_id}, ${user_id}, ${issue_id}, ${promise_text}, ${due_at.toISOString()}, 'pending')
    RETURNING id
  `;
  return rows[0].id;
}

async function findDueCommitments() {
  const sql = getDb();
  return await sql`
    SELECT c.id, c.thread_id, c.user_id, c.issue_id, c.promise_text, c.due_at,
           du.telegram_id AS user_telegram_id, du.display_name AS user_display_name,
           i.redmine_id AS issue_redmine_id
      FROM commitments c
      JOIN dashboard_users du ON du.id = c.user_id
      LEFT JOIN issues i ON i.id = c.issue_id
     WHERE c.status = 'pending'
       AND c.due_at <= NOW()
     ORDER BY c.due_at ASC
     LIMIT 20
  `;
}

async function markCommitment(id, status) {
  if (!['kept','missed','followed_up'].includes(status)) {
    throw new Error(`invalid commitment status: ${status}`);
  }
  const sql = getDb();
  await sql`
    UPDATE commitments
    SET status = ${status}, resolved_at = CASE WHEN ${status} <> 'followed_up' THEN NOW() ELSE resolved_at END
    WHERE id = ${id}
  `;
}
```

Update `module.exports`:

```javascript
module.exports = { extractCommitment, createCommitment, findDueCommitments, markCommitment };
```

- [ ] **Step 2: Run existing tests**

```bash
npm run test:unit
```

Expected: all existing tests still pass (no new tests in this task — these are pure DB wrappers best validated by the manual smoke test).

- [ ] **Step 3: Commit**

```bash
git add lib/commitments.js
git commit -m "feat(commitments): storage + due-commitment lookup"
```

---

## Task 10: `lib/chat-enrichment.js` — enrichment pipeline

**Files:**
- Create: `lib/chat-enrichment.js`

- [ ] **Step 1: Implement the pipeline**

Create `lib/chat-enrichment.js`:

```javascript
/**
 * lib/chat-enrichment.js
 * Tags unenriched chat_history rows with intent + entities for future
 * personalization phases (ideas A/B/C/E). Non-blocking — runs via cron.
 */

const { chat } = require('./ai');
const { getDb } = require('./db');

const INTENT_ENUM = [
  'query_ticket_status',
  'intimate_person',
  'log_time',
  'ask_person_summary',
  'ask_project_status',
  'other',
];

const SYSTEM_PROMPT = `You classify short user messages from a company operations bot.
Return STRICT JSON: { "intent": "<one_of>", "entities": { "tickets": [int...], "users": [name...], "projects": [name...] } }
Allowed intents: ${INTENT_ENUM.join(', ')}
- tickets: extract numeric ticket IDs (TK-12345 -> 12345).
- users: extract person names mentioned (strings, no guessing).
- projects: extract project names mentioned.
If none, use empty arrays. Never invent.`;

async function classifyOne(content) {
  const resp = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content },
  ]);
  const text = resp.choices?.[0]?.message?.content || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const intent = INTENT_ENUM.includes(parsed.intent) ? parsed.intent : 'other';
    const entities = {
      tickets: Array.isArray(parsed.entities?.tickets) ? parsed.entities.tickets.filter(Number.isInteger) : [],
      users: Array.isArray(parsed.entities?.users) ? parsed.entities.users.slice(0, 10).map(String) : [],
      projects: Array.isArray(parsed.entities?.projects) ? parsed.entities.projects.slice(0, 10).map(String) : [],
    };
    return { intent, entities };
  } catch (e) {
    return null;
  }
}

/**
 * Process up to `limit` unenriched chat_history rows. Returns { processed, failed }.
 */
async function runEnrichmentBatch(limit = 50) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, content
      FROM chat_history
     WHERE enriched_at IS NULL
       AND role = 'user'
     ORDER BY created_at ASC
     LIMIT ${limit}
  `;
  let processed = 0, failed = 0;
  for (const row of rows) {
    try {
      const result = await classifyOne(row.content);
      if (!result) { failed++; continue; }
      await sql`
        UPDATE chat_history
        SET intent = ${result.intent},
            entities = ${JSON.stringify(result.entities)}::jsonb,
            enriched_at = NOW()
        WHERE id = ${row.id}
      `;
      processed++;
    } catch (e) {
      console.error('enrichment row failed:', row.id, e.message);
      failed++;
    }
  }
  // Also mark non-user (assistant/tool) rows as "enriched" with null intent so they don't clog the queue.
  await sql`
    UPDATE chat_history
    SET enriched_at = NOW()
    WHERE enriched_at IS NULL AND role <> 'user'
  `;
  return { processed, failed, scanned: rows.length };
}

module.exports = { runEnrichmentBatch, classifyOne, INTENT_ENUM };
```

- [ ] **Step 2: Confirm tests still pass**

```bash
npm run test:unit
```

Expected: no regression (we added no new tests for this module — it's a straightforward AI-call loop; validated by the manual smoke test).

- [ ] **Step 3: Commit**

```bash
git add lib/chat-enrichment.js
git commit -m "feat(enrichment): batch classifier for chat_history intent+entities"
```

---

## Task 11: Add `propose_intimation` AI tool

**Files:**
- Modify: `lib/gpt-tools.js`
- Modify: `lib/gpt-executor.js`

- [ ] **Step 1: Add tool definition**

Open [lib/gpt-tools.js](../../../lib/gpt-tools.js). Find the closing `];` of the `tools` array. Insert before it:

```javascript
  {
    type: 'function',
    function: {
      name: 'propose_intimation',
      description:
        'Propose sending an intimation to a developer about a Redmine ticket. Use when the user asks to "ping", "ask", "intimate", or "escalate to" a person about a ticket. Returns a preview the bot will confirm with [Yes, send] / [Cancel] buttons — do not send directly.',
      parameters: {
        type: 'object',
        required: ['target_user_hint', 'issue_redmine_id'],
        properties: {
          target_user_hint: {
            type: 'string',
            description: 'Developer name or partial name to intimate (e.g., "Ravi", "Priya S").',
          },
          issue_redmine_id: {
            type: 'integer',
            description: 'The Redmine issue id (TK-12345 -> 12345).',
          },
          note: {
            type: 'string',
            description: 'Optional extra context the originator wants included in the message.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_commitment',
      description:
        'Extract a time-bound commitment ("EOD", "tomorrow 5pm", "by Friday") from a developer reply. Returns null if none found.',
      parameters: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'Reply text to scan for a commitment.' },
        },
      },
    },
  },
```

- [ ] **Step 2: Route tool in executor**

Open [lib/gpt-executor.js](../../../lib/gpt-executor.js). Add imports at the top (below the `getDb` import):

```javascript
const { canIntimate } = require('./intimation-relay');
const { extractCommitment } = require('./commitments');
```

Inside the `switch (toolName) { ... }` block, add cases (before the `default:` case):

```javascript
      // ─────────────────────────────────────────────────
      // PROPOSE INTIMATION
      // ─────────────────────────────────────────────────
      case 'propose_intimation': {
        const { target_user_hint, issue_redmine_id, note } = args || {};
        if (!target_user_hint || !issue_redmine_id) {
          return JSON.stringify({ error: 'target_user_hint and issue_redmine_id are required' });
        }

        // Resolve target: developers only in Phase 1
        const candidates = await sql`
          SELECT id, display_name, username, role, team, telegram_id, consent_given_at
            FROM dashboard_users
           WHERE role = 'developer'
             AND active = true
             AND (display_name ILIKE ${'%' + target_user_hint + '%'}
                  OR username ILIKE ${'%' + target_user_hint + '%'})
           LIMIT 5
        `;
        if (candidates.length === 0) {
          return JSON.stringify({ error: `No developer matches "${target_user_hint}".` });
        }
        if (candidates.length > 1) {
          return JSON.stringify({
            ambiguous: true,
            candidates: candidates.map(c => ({ id: c.id, display_name: c.display_name, team: c.team })),
            hint: 'Ask the user to pick one.',
          });
        }

        const target = candidates[0];
        const perm = canIntimate({ role: currentUser.role, team: currentUser.team }, { role: target.role, team: target.team });
        if (!perm.allowed) return JSON.stringify({ error: perm.reason });

        if (!target.telegram_id) return JSON.stringify({ error: `${target.display_name} hasn't registered Telegram yet.` });
        if (!target.consent_given_at) return JSON.stringify({ error: `${target.display_name} hasn't given consent yet. They need to message the bot and reply /agree first.` });

        const issueRow = await sql`
          SELECT id, redmine_id, subject, status, due_date,
                 GREATEST(0, (CURRENT_DATE - due_date))::int AS days_overdue
            FROM issues WHERE redmine_id = ${issue_redmine_id} LIMIT 1
        `;
        if (issueRow.length === 0) return JSON.stringify({ error: `No ticket TK-${issue_redmine_id} found.` });

        return JSON.stringify({
          confirm_required: true,
          preview: {
            target_user_id: target.id,
            target_display_name: target.display_name,
            issue_id: issueRow[0].id,
            issue_redmine_id: issueRow[0].redmine_id,
            issue_subject: issueRow[0].subject,
            days_overdue: issueRow[0].days_overdue,
            note: note || '',
          },
          next_step: 'The bot must render a preview card with [Yes, send] / [Cancel] buttons whose callback_data is `int:confirm:<target_user_id>:<issue_id>` and `int:cancel`.',
        });
      }

      // ─────────────────────────────────────────────────
      // EXTRACT COMMITMENT
      // ─────────────────────────────────────────────────
      case 'extract_commitment': {
        const { text } = args || {};
        if (!text) return JSON.stringify({ error: 'text is required' });
        const r = await extractCommitment({ text, now: new Date() });
        return JSON.stringify(r || { has_commitment: false });
      }
```

- [ ] **Step 3: Run unit tests — nothing should have broken**

```bash
npm run test:unit
```

Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add lib/gpt-tools.js lib/gpt-executor.js
git commit -m "feat(ai-tools): propose_intimation and extract_commitment"
```

---

## Task 12: Intimation callback handler — confirm + receiver buttons

**Files:**
- Create: `bots/telegram/handlers/intimation.js`

- [ ] **Step 1: Implement the handler**

Create `bots/telegram/handlers/intimation.js`:

```javascript
/**
 * bots/telegram/handlers/intimation.js
 * Handles inline-keyboard callbacks for Intimation Relay.
 *
 * callback_data prefixes:
 *   int:confirm:<target_id>:<issue_id>   — originator confirms send
 *   int:cancel                            — originator cancels
 *   int:ack:<thread_id>                   — receiver acknowledges
 *   int:working:<thread_id>               — receiver 'working on it'
 *   int:blocked:<thread_id>               — receiver 'blocked'
 *   int:escalate:<thread_id>              — originator escalates after no_response
 *   int:close:<thread_id>                 — originator closes thread
 *   int:commit_done:<commitment_id>       — dev reports commitment kept
 *   int:commit_extend:<commitment_id>     — dev needs more time
 */

const { getDb } = require('../../../lib/db');
const {
  createThread, logEvent, transitionStatus, sendIntimation, relayResponse,
} = require('../../../lib/intimation-relay');
const { markCommitment } = require('../../../lib/commitments');

async function loadUser(sql, id) {
  const rows = await sql`SELECT id, display_name, username, role, team, telegram_id FROM dashboard_users WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

async function loadIssue(sql, id) {
  const rows = await sql`
    SELECT id, redmine_id, subject, status, due_date,
           GREATEST(0, (CURRENT_DATE - due_date))::int AS days_overdue
      FROM issues WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

async function loadThreadFull(sql, thread_id) {
  const rows = await sql`
    SELECT t.*, i.redmine_id, i.subject AS issue_subject,
           tgt.display_name AS target_display_name
      FROM bot_threads t
      JOIN issues i ON i.id = t.issue_id
      JOIN dashboard_users tgt ON tgt.id = t.target_id
     WHERE t.id = ${thread_id} LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Returns true if the callback was handled by this module.
 */
async function handleIntimationCallback(ctx, botUser) {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith('int:')) return false;

  const sql = getDb();
  const parts = data.split(':');

  try {
    if (parts[1] === 'confirm') {
      const target_id = Number(parts[2]);
      const issue_id = Number(parts[3]);
      const originator = botUser;
      const target = await loadUser(sql, target_id);
      const issue = await loadIssue(sql, issue_id);
      if (!target || !issue) {
        await ctx.answerCbQuery('Target or issue not found');
        return true;
      }
      // CC rule: manager->dev CCs the dev's TL
      let cc = null;
      if (originator.role === 'manager' && target.team) {
        const tlRows = await sql`
          SELECT id, display_name, telegram_id
            FROM dashboard_users
           WHERE role = 'team_lead' AND team = ${target.team} AND active = true
           LIMIT 1
        `;
        if (tlRows.length) cc = tlRows[0];
      }
      const thread_id = await createThread({
        originator_id: originator.id,
        target_id: target.id,
        cc_user_id: cc ? cc.id : null,
        issue_id: issue.id,
      });
      await sendIntimation({ thread_id, originator, target, cc, issue });
      await ctx.editMessageText(`✓ Intimation sent to ${target.display_name}.`).catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'cancel') {
      await ctx.editMessageText('Cancelled.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (['ack','working','blocked'].includes(parts[1])) {
      const thread_id = Number(parts[2]);
      const thread = await loadThreadFull(sql, thread_id);
      if (!thread) { await ctx.answerCbQuery('Thread not found'); return true; }
      if (thread.target_id !== botUser.id) { await ctx.answerCbQuery('Not for you'); return true; }

      const labelMap = { ack: 'Acknowledged', working: 'Working on it', blocked: 'Blocked' };
      const buttonLabel = labelMap[parts[1]];

      await logEvent({
        thread_id,
        actor_id: botUser.id,
        event_type: 'button_reply',
        payload: { button: parts[1] },
      });
      await transitionStatus(thread_id, parts[1] === 'ack' ? 'acked' : 'replied');

      const originator = await loadUser(sql, thread.originator_id);
      const cc = thread.cc_user_id ? await loadUser(sql, thread.cc_user_id) : null;

      await relayResponse({
        thread: { redmine_id: thread.redmine_id, target_display_name: thread.target_display_name },
        originator,
        cc,
        responseText: null,
        buttonLabel,
      });
      await logEvent({
        thread_id,
        actor_id: botUser.id,
        event_type: 'relayed_to_originator',
        payload: { button: parts[1] },
      });
      await ctx.editMessageText(`✓ ${buttonLabel} — sent to ${originator.display_name}.`).catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'escalate') {
      const thread_id = Number(parts[2]);
      const thread = await loadThreadFull(sql, thread_id);
      if (!thread) { await ctx.answerCbQuery('Thread not found'); return true; }
      // Phase 1: escalation is a TL alert (if there's one) or noop
      if (thread.cc_user_id) {
        const tl = await loadUser(sql, thread.cc_user_id);
        if (tl?.telegram_id) {
          await relayResponse({
            thread: { redmine_id: thread.redmine_id, target_display_name: thread.target_display_name },
            originator: tl,
            cc: null,
            responseText: `Please follow up with ${thread.target_display_name} on TK-${thread.redmine_id} — no response in 24h.`,
          });
        }
      }
      await transitionStatus(thread_id, 'closed');
      await logEvent({ thread_id, actor_id: botUser.id, event_type: 'closed', payload: { via: 'escalate' } });
      await ctx.editMessageText('Escalated and closed.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'close') {
      const thread_id = Number(parts[2]);
      await transitionStatus(thread_id, 'closed');
      await logEvent({ thread_id, actor_id: botUser.id, event_type: 'closed', payload: { via: 'manual' } });
      await ctx.editMessageText('Closed.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'commit_done') {
      const commitment_id = Number(parts[2]);
      await markCommitment(commitment_id, 'kept');
      await ctx.editMessageText('Great — marked as kept.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'commit_extend') {
      const commitment_id = Number(parts[2]);
      await markCommitment(commitment_id, 'missed');
      await ctx.editMessageText('Noted — I\'ll let the originator know you need more time.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    await ctx.answerCbQuery('Unknown intimation action');
    return true;
  } catch (e) {
    console.error('intimation handler error:', e);
    await ctx.answerCbQuery('Something went wrong').catch(() => {});
    return true;
  }
}

module.exports = { handleIntimationCallback };
```

- [ ] **Step 2: Smoke-compile**

```bash
node -e "require('./bots/telegram/handlers/intimation')"
```

Expected: no output, no error. If you see a module-resolution error, fix the relative path.

- [ ] **Step 3: Commit**

```bash
git add bots/telegram/handlers/intimation.js
git commit -m "feat(bot): intimation callback handler for confirm, ack, escalate"
```

---

## Task 13: Wire handler into bot; add role_at_time + thread continuation

**Files:**
- Modify: `bots/telegram/index.js`

- [ ] **Step 1: Import the handler**

Open [bots/telegram/index.js](../../../bots/telegram/index.js). Near the top with other requires, add:

```javascript
const { handleIntimationCallback } = require('./handlers/intimation');
const { getOpenThreadForTarget, logEvent, transitionStatus, relayResponse } = require('../../lib/intimation-relay');
const { extractCommitment, createCommitment } = require('../../lib/commitments');
```

- [ ] **Step 2: Route intimation callbacks**

Find the `bot.on('callback_query', ...)` block. Inside the `try`, **before** the `handleOnboardingCallback` call, add:

```javascript
    // Intimation callbacks (prefix 'int:') take priority over onboarding
    try {
      const intHandled = await handleIntimationCallback(ctx, user);
      if (intHandled) return;
    } catch (e) {
      console.error('Intimation callback error:', e.message);
    }
```

- [ ] **Step 3: Capture `role_at_time` on chat_history inserts**

In the same file, locate the two `INSERT INTO chat_history` statements inside the `bot.on('text', ...)` handler. Update both to include `role_at_time`:

Replace:

```javascript
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, created_at)
        VALUES (${user.id}, 'user', ${message}, ${JSON.stringify({ source: 'telegram', telegram_id: String(ctx.from.id) })}, NOW())
      `;
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, created_at)
        VALUES (${user.id}, 'assistant', ${replyText}, ${JSON.stringify({ source: 'telegram', tool_rounds: toolRounds })}, NOW())
      `;
```

With:

```javascript
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, role_at_time, created_at)
        VALUES (${user.id}, 'user', ${message}, ${JSON.stringify({ source: 'telegram', telegram_id: String(ctx.from.id) })}, ${user.role}, NOW())
      `;
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, role_at_time, created_at)
        VALUES (${user.id}, 'assistant', ${replyText}, ${JSON.stringify({ source: 'telegram', tool_rounds: toolRounds })}, ${user.role}, NOW())
      `;
```

- [ ] **Step 4: Thread-continuation: if a developer sends free text and has an open thread <2h ago, relay as text_reply**

Still inside `bot.on('text', ...)`, **immediately after** the onboarding-text check and **before** the `const message = ctx.message.text;` line is read by the AI pipeline, insert:

```javascript
  // Thread continuation: if this user is a developer with an open thread and sends free text,
  // treat it as a reply on that thread (provided last activity was within 2 hours).
  if (user.role === 'developer') {
    try {
      const open = await getOpenThreadForTarget(user.id);
      if (open) {
        const lastMs = new Date(open.last_event_at).getTime();
        if (Date.now() - lastMs <= 2 * 60 * 60 * 1000) {
          const text = ctx.message.text;
          await logEvent({
            thread_id: open.id,
            actor_id: user.id,
            event_type: 'text_reply',
            payload: { text },
          });
          await transitionStatus(open.id, 'replied');

          // Extract commitment (best-effort)
          try {
            const commit = await extractCommitment({ text, now: new Date() });
            if (commit) {
              await createCommitment({
                thread_id: open.id,
                user_id: user.id,
                issue_id: open.issue_id,
                promise_text: commit.promise_text,
                due_at: commit.due_at,
              });
            }
          } catch (e) { console.error('commit extract in thread reply:', e.message); }

          // Relay to originator + CC
          const originatorRows = await sql`
            SELECT id, display_name, telegram_id FROM dashboard_users WHERE id = ${open.originator_id} LIMIT 1
          `;
          const ccRows = open.cc_user_id ? await sql`
            SELECT id, display_name, telegram_id FROM dashboard_users WHERE id = ${open.cc_user_id} LIMIT 1
          ` : [];
          const issueRows = await sql`SELECT redmine_id FROM issues WHERE id = ${open.issue_id} LIMIT 1`;

          await relayResponse({
            thread: { redmine_id: issueRows[0]?.redmine_id, target_display_name: user.display_name || user.username },
            originator: originatorRows[0],
            cc: ccRows[0] || null,
            responseText: text,
          });
          await logEvent({
            thread_id: open.id,
            actor_id: user.id,
            event_type: 'relayed_to_originator',
            payload: { text_preview: text.slice(0, 100) },
          });

          await ctx.reply('✓ Relayed your reply to the originator.');
          return; // stop: don't run AI pipeline
        }
      }
    } catch (e) {
      console.error('thread continuation check error:', e.message);
    }
  }
```

- [ ] **Step 5: Intercept `confirm_required` tool results and render the preview card with inline buttons**

The AI tool `propose_intimation` returns `{ confirm_required: true, preview: {...} }`. The AI can't produce inline-keyboard buttons — only plain text. So the bot must intercept this specific tool-result shape and render the preview card itself, short-circuiting the AI follow-up.

Inside `bot.on('text', ...)`, locate the tool-call loop (the `while (reply.tool_calls && reply.tool_calls.length > 0 && toolRounds < MAX_TOOL_ROUNDS)` block). Inside the `for (const tc of reply.tool_calls)` loop, **after** `const result = await executeToolCall(...)` and **before** `messages.push({ role: 'tool', ... })`, add:

```javascript
        // Intercept propose_intimation confirmations: bot renders the preview card itself.
        if (tc.function.name === 'propose_intimation') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.confirm_required && parsed.preview) {
              const p = parsed.preview;
              const overdueBit = (p.days_overdue && p.days_overdue > 0) ? ` (overdue ${p.days_overdue}d)` : '';
              const noteBit = p.note ? `\n\n_${p.note}_` : '';
              const text = `Send this to *${p.target_display_name}*?\n\n[TK-${p.issue_redmine_id}](https://redmine.thinkingcode.com/issues/${p.issue_redmine_id}) '${p.issue_subject}'${overdueBit}.${noteBit}`;
              await ctx.reply(text, {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    { text: 'Yes, send', callback_data: `int:confirm:${p.target_user_id}:${p.issue_id}` },
                    { text: 'Cancel', callback_data: 'int:cancel' },
                  ]],
                },
              });
              // Short-circuit: don't loop the AI. Save the user message, skip the reply save.
              try {
                await saveMessage(user.id, 'user', message);
              } catch (e) { /* ignore */ }
              return;
            }
            if (parsed.ambiguous && Array.isArray(parsed.candidates)) {
              const lines = parsed.candidates.map((c, i) => `${i + 1}. ${c.display_name} (${c.team || '—'})`).join('\n');
              await ctx.reply(`Multiple matches — which one?\n${lines}\n\n_Reply with the name_`);
              return;
            }
            if (parsed.error) {
              await ctx.reply(parsed.error);
              return;
            }
          } catch (e) {
            console.error('propose_intimation intercept parse error:', e.message);
            // fall through — let AI handle the result normally
          }
        }
```

- [ ] **Step 6: Smoke-compile**

```bash
node -e "require('./bots/telegram/index')"
```

Expected: no error.

- [ ] **Step 7: Commit**

```bash
git add bots/telegram/index.js
git commit -m "feat(bot): wire intimation handler, role_at_time, thread continuation, NL intercept"
```

---

## Task 14: Teach the AI model about intimation (prompt)

**Files:**
- Modify: `bots/telegram/prompt.js`

- [ ] **Step 1: Add intimation guidance to the prompt**

Open [bots/telegram/prompt.js](../../../bots/telegram/prompt.js). Find the `## Tool Usage` section inside the returned prompt string. Add this new section **after** the `## Tool Usage` block and **before** `## Date Context`:

```javascript
## Intimation Relay
- When the user wants to "ping", "ask", "intimate", "escalate to", or "nudge" a developer about a ticket, call \`propose_intimation({ target_user_hint, issue_redmine_id, note? })\` — do NOT draft or send the message yourself.
- After you call \`propose_intimation\`, the bot will intercept the tool result and render the confirmation card with Yes/Cancel buttons automatically. You do not need to produce any text for that case — just make the tool call. If you produce text anyway, it will be ignored for \`confirm_required\` results.
- When listing problem tickets (overdue, blocked, stuck), mention that the user can intimate the assignee by name — e.g., "You can ping Ravi by saying 'ask Ravi about TK-1234'."
`
```

(Note: the existing prompt string is a template literal. Insert the block above inside the same template literal — keep the backtick quoting consistent with surrounding text.)

- [ ] **Step 2: Smoke-compile**

```bash
node -e "const { buildSystemPrompt } = require('./bots/telegram/prompt'); console.log(buildSystemPrompt({ role: 'manager', display_name: 'Upendra', team: 'Ops' }).slice(0, 200))"
```

Expected: prints the first 200 chars of a prompt string. If it throws, a template-literal quote got unbalanced — fix and retry.

- [ ] **Step 3: Commit**

```bash
git add bots/telegram/prompt.js
git commit -m "feat(bot): teach model about propose_intimation tool usage"
```

---

## Task 15: Developer consent flow in onboarding

**Files:**
- Modify: `bots/telegram/onboarding.js`
- Modify: `bots/telegram/index.js`

- [ ] **Step 1: Add a developer-consent helper in onboarding.js**

Open [bots/telegram/onboarding.js](../../../bots/telegram/onboarding.js). Append before `module.exports`:

```javascript
// ── Developer consent (Phase 1) ────────────────────────────────

const CONSENT_TEXT =
  `Your messages to this bot are logged and may be reviewed by your manager or team lead for coaching and delivery purposes.\n\n` +
  `Reply */agree* to continue receiving intimations and relaying replies, or */revoke* at any time to stop.`;

async function sendDeveloperConsent(ctx) {
  await ctx.reply(CONSENT_TEXT, { parse_mode: 'Markdown' });
}

async function recordConsent(userId) {
  const sql = getDb();
  await sql`UPDATE dashboard_users SET consent_given_at = NOW() WHERE id = ${userId}`;
}

async function revokeConsent(userId) {
  const sql = getDb();
  await sql`UPDATE dashboard_users SET consent_given_at = NULL WHERE id = ${userId}`;
}
```

Update `module.exports` at the bottom:

```javascript
module.exports = {
  startOnboarding,
  handleOnboardingCallback,
  handleOnboardingText,
  sendDeveloperConsent,
  recordConsent,
  revokeConsent,
};
```

- [ ] **Step 2: Wire consent into bot `/start`, `/agree`, `/revoke`**

Open [bots/telegram/index.js](../../../bots/telegram/index.js). Update the top imports to include the new exports:

Change:

```javascript
const { startOnboarding, handleOnboardingCallback, handleOnboardingText } = require('./onboarding');
```

to:

```javascript
const {
  startOnboarding, handleOnboardingCallback, handleOnboardingText,
  sendDeveloperConsent, recordConsent, revokeConsent,
} = require('./onboarding');
```

Inside `bot.start(async (ctx) => { ... })`, at the top (before the existing greeting), add:

```javascript
  // Developers get a consent screen first — not the full onboarding.
  if (user.role === 'developer') {
    if (!user.consent_given_at) {
      await sendDeveloperConsent(ctx);
      return;
    }
    await ctx.reply(
      `Hi ${user.display_name || user.username}. You're registered. I'll send you intimations here from your manager or team lead — you can respond with the buttons or plain text.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
```

Still in `index.js`, add two new command handlers near `/preferences`:

```javascript
bot.command('agree', async (ctx) => {
  const user = ctx.botUser;
  if (!user || user.role !== 'developer') {
    return ctx.reply('This command is only for developer accounts.');
  }
  await recordConsent(user.id);
  await ctx.reply('✓ Thanks — consent recorded. You\'ll now receive intimations here.');
});

bot.command('revoke', async (ctx) => {
  const user = ctx.botUser;
  if (!user || user.role !== 'developer') {
    return ctx.reply('This command is only for developer accounts.');
  }
  await revokeConsent(user.id);
  await ctx.reply('Consent revoked. I won\'t relay messages to/from you until you run /agree again.');
});
```

Also: in the auth middleware (`bot.use(async (ctx, next) => ...)`), **after** the user row is fetched but before `return next()`, add a gate so developers without consent can only use `/agree`:

```javascript
    // Developer consent gate
    if (users[0].role === 'developer' && !users[0].consent_given_at) {
      const txt = ctx.message?.text || '';
      if (!['/start','/agree'].some(cmd => txt === cmd || txt.startsWith(cmd + ' '))) {
        await ctx.reply('Please reply /agree first to continue.');
        return;
      }
    }
```

- [ ] **Step 3: Smoke-compile**

```bash
node -e "require('./bots/telegram/index')"
```

Expected: no error.

- [ ] **Step 4: Commit**

```bash
git add bots/telegram/onboarding.js bots/telegram/index.js
git commit -m "feat(bot): developer consent flow with /agree and /revoke"
```

---

## Task 16: Intimation-followup cron

**Files:**
- Create: `crons/intimation-followup.js`

- [ ] **Step 1: Implement the cron**

Create `crons/intimation-followup.js`:

```javascript
/**
 * crons/intimation-followup.js
 * - Nudges unanswered threads at 4h (status: sent -> timeout_nudged).
 * - Closes unanswered threads at 24h (status: timeout_nudged -> no_response),
 *   notifying the originator with escalate/close buttons.
 */

const { getDb } = require('../lib/db');
const { logEvent, transitionStatus } = require('../lib/intimation-relay');

async function tgSend(chat_id, text, reply_markup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id, text, parse_mode: 'Markdown' };
  if (reply_markup) body.reply_markup = reply_markup;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`);
}

async function runIntimationFollowup() {
  const sql = getDb();
  let nudged = 0, closed = 0;

  // 4h nudge: status='sent' AND last_event_at < now - 4h
  const toNudge = await sql`
    SELECT t.id, t.target_id, t.originator_id, t.issue_id,
           tgt.display_name AS target_name, tgt.telegram_id AS target_tg,
           orig.display_name AS originator_name,
           i.redmine_id
      FROM bot_threads t
      JOIN dashboard_users tgt ON tgt.id = t.target_id
      JOIN dashboard_users orig ON orig.id = t.originator_id
      JOIN issues i ON i.id = t.issue_id
     WHERE t.status = 'sent'
       AND t.last_event_at < NOW() - INTERVAL '4 hours'
     LIMIT 50
  `;
  for (const row of toNudge) {
    try {
      const msg = `Gentle reminder — *${row.originator_name}* is waiting on status for [TK-${row.redmine_id}](https://redmine.thinkingcode.com/issues/${row.redmine_id}).`;
      await tgSend(row.target_tg, msg);
      await logEvent({ thread_id: row.id, actor_id: null, event_type: 'nudged', payload: { reason: '4h_no_response' } });
      await transitionStatus(row.id, 'timeout_nudged');
      nudged++;
    } catch (e) {
      console.error('nudge failed', row.id, e.message);
    }
  }

  // 24h close: status='timeout_nudged' AND created_at < now - 24h
  const toClose = await sql`
    SELECT t.id, t.originator_id, t.issue_id, t.cc_user_id, t.target_id,
           orig.display_name AS originator_name, orig.telegram_id AS originator_tg,
           tgt.display_name AS target_name,
           i.redmine_id
      FROM bot_threads t
      JOIN dashboard_users orig ON orig.id = t.originator_id
      JOIN dashboard_users tgt ON tgt.id = t.target_id
      JOIN issues i ON i.id = t.issue_id
     WHERE t.status = 'timeout_nudged'
       AND t.created_at < NOW() - INTERVAL '24 hours'
     LIMIT 50
  `;
  for (const row of toClose) {
    try {
      const msg = `*${row.target_name}* hasn't responded about [TK-${row.redmine_id}](https://redmine.thinkingcode.com/issues/${row.redmine_id}) in 24h.`;
      const kb = {
        inline_keyboard: [[
          { text: 'Escalate to TL', callback_data: `int:escalate:${row.id}` },
          { text: 'Close', callback_data: `int:close:${row.id}` },
        ]],
      };
      await tgSend(row.originator_tg, msg, kb);
      await transitionStatus(row.id, 'no_response');
      await logEvent({ thread_id: row.id, actor_id: null, event_type: 'closed', payload: { reason: '24h_no_response' } });
      closed++;
    } catch (e) {
      console.error('close failed', row.id, e.message);
    }
  }

  return { nudged, closed };
}

module.exports = { runIntimationFollowup };
```

- [ ] **Step 2: Smoke-compile**

```bash
node -e "require('./crons/intimation-followup')"
```

Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add crons/intimation-followup.js
git commit -m "feat(cron): 4h nudge + 24h close for intimation threads"
```

---

## Task 17: Commitment-followup cron

**Files:**
- Create: `crons/commitment-followup.js`

- [ ] **Step 1: Implement**

Create `crons/commitment-followup.js`:

```javascript
/**
 * crons/commitment-followup.js
 * For every pending commitment whose due_at has passed, DM the dev
 * asking [Yes, done] / [Needs more time] and mark it followed_up.
 */

const { findDueCommitments, markCommitment } = require('../lib/commitments');

async function tgSend(chat_id, text, reply_markup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id, text, parse_mode: 'Markdown' };
  if (reply_markup) body.reply_markup = reply_markup;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`);
}

async function runCommitmentFollowup() {
  const due = await findDueCommitments();
  let followed = 0;
  for (const c of due) {
    try {
      const link = c.issue_redmine_id
        ? `[TK-${c.issue_redmine_id}](https://redmine.thinkingcode.com/issues/${c.issue_redmine_id})`
        : 'that item';
      const msg = `You said '${c.promise_text}' on ${link}. Is it done?`;
      const kb = {
        inline_keyboard: [[
          { text: 'Yes, done', callback_data: `int:commit_done:${c.id}` },
          { text: 'Needs more time', callback_data: `int:commit_extend:${c.id}` },
        ]],
      };
      await tgSend(c.user_telegram_id, msg, kb);
      await markCommitment(c.id, 'followed_up');
      followed++;
    } catch (e) {
      console.error('commitment followup failed', c.id, e.message);
    }
  }
  return { followed };
}

module.exports = { runCommitmentFollowup };
```

- [ ] **Step 2: Smoke-compile**

```bash
node -e "require('./crons/commitment-followup')"
```

Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add crons/commitment-followup.js
git commit -m "feat(cron): commitment followup DMs at due time"
```

---

## Task 18: Chat-enrichment cron wrapper

**Files:**
- Create: `crons/chat-enrichment.js`

- [ ] **Step 1: Implement**

Create `crons/chat-enrichment.js`:

```javascript
/**
 * crons/chat-enrichment.js
 * Thin wrapper around lib/chat-enrichment so the Vercel dispatcher can invoke it.
 */

const { runEnrichmentBatch } = require('../lib/chat-enrichment');

async function runChatEnrichment() {
  return await runEnrichmentBatch(50);
}

module.exports = { runChatEnrichment };
```

- [ ] **Step 2: Commit**

```bash
git add crons/chat-enrichment.js
git commit -m "feat(cron): chat enrichment wrapper for dispatcher"
```

---

## Task 19: Single Vercel cron entry — `phase1-tick`

**Files:**
- Create: `pages/api/cron/phase1-tick.js`
- Modify: `vercel.json`

- [ ] **Step 1: Implement the dispatcher API route**

Create `pages/api/cron/phase1-tick.js`:

```javascript
/**
 * pages/api/cron/phase1-tick.js
 * Single Vercel cron entry that invokes all three Phase 1 background jobs:
 * intimation-followup, commitment-followup, chat-enrichment.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  const bearer = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null;
  if (secret !== process.env.CRON_SECRET && bearer !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = {};
  const started = Date.now();

  try {
    const { runIntimationFollowup } = require('../../../crons/intimation-followup');
    results.intimation = await runIntimationFollowup();
  } catch (e) {
    results.intimation = { error: e.message };
  }

  try {
    const { runCommitmentFollowup } = require('../../../crons/commitment-followup');
    results.commitment = await runCommitmentFollowup();
  } catch (e) {
    results.commitment = { error: e.message };
  }

  try {
    const { runChatEnrichment } = require('../../../crons/chat-enrichment');
    results.enrichment = await runChatEnrichment();
  } catch (e) {
    results.enrichment = { error: e.message };
  }

  return res.status(200).json({
    ok: true,
    duration_ms: Date.now() - started,
    results,
  });
}
```

- [ ] **Step 2: Add the Vercel cron entry**

Open [vercel.json](../../../vercel.json). Inside the `"crons"` array, append:

```json
    {
      "path": "/api/cron/phase1-tick",
      "schedule": "*/15 * * * *"
    }
```

(Mind the trailing comma on the previous object. Resulting array should have 6 entries.)

- [ ] **Step 3: Flag Hobby-plan risk**

If Vercel rejects deployment with "too many cron jobs," you have three options; pick one during deploy:
1. Upgrade the Vercel plan.
2. Remove one of the existing crons that can be deprecated (see commit 09d702a context).
3. Move `phase1-tick` to run from an external scheduler (e.g., GitHub Actions) that hits the endpoint.

Do not block Task 19 on this; the code path works regardless of scheduler source.

- [ ] **Step 4: Local test the dispatcher**

With the dev server running (`npm run dev`), in another terminal:

```bash
curl -i "http://localhost:3000/api/cron/phase1-tick?secret=$CRON_SECRET"
```

Expected: `200 OK` with JSON `{ ok: true, duration_ms: N, results: { intimation: {nudged:0,closed:0}, commitment: {followed:0}, enrichment: {processed:X,failed:0,scanned:Y} } }`.

- [ ] **Step 5: Commit**

```bash
git add pages/api/cron/phase1-tick.js vercel.json
git commit -m "feat(cron): phase1-tick dispatcher running every 15 min"
```

---

## Task 20: Flag intimation-eligible tickets in tool results

**Scope note:** The spec decided on both auto-offer buttons AND natural-language triggering. Phase 1 fully ships the NL flow (end-to-end via `propose_intimation`). Inline `[Intimate <name>]` buttons rendered *next to* ticket rows require a tool-result-to-inline-keyboard post-processor that doesn't currently exist in the bot pipeline — the AI returns plain text, and `sendChunkedReply` has no structured-UI hook. Phase 1 stops at flagging rows as `can_intimate: true` in tool results and teaching the prompt to mention the button, so the AI can tell users "you can intimate Ravi — just say 'ping Ravi about TK-123'." Actual inline keyboards on ticket rows are **deferred to Phase 1.5** (a small post-processor change), explicitly noted here so it's not silently lost.

**Files:**
- Modify: `lib/gpt-executor.js`

- [ ] **Step 1: Add `assigned_to_id` to every `get_tickets` SELECT**

Open [lib/gpt-executor.js](../../../lib/gpt-executor.js). In the `case 'get_tickets':` block, there are **six** SELECT statements (three logical branches × teamFilter yes/no): the `status === 'overdue'` branch, the `status === 'closed'` branch, and the general branch, each with and without `u.team = ${teamFilter}`.

In **each** of the six SELECT column lists, add `i.assigned_to_id AS assignee_id,` immediately after `i.redmine_id,`. Example transformation of the first SELECT:

Before:
```javascript
SELECT
  i.id, i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team
```

After:
```javascript
SELECT
  i.id, i.redmine_id, i.assigned_to_id AS assignee_id,
  'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team
```

Repeat for all six SELECTs in the `case 'get_tickets':` block.

- [ ] **Step 2: Flag rows with `can_intimate` before returning**

Still in `case 'get_tickets':`, find the line where `rows` is returned (it's the final `return JSON.stringify(...)` in that case). Immediately **above** the return, insert:

```javascript
        const CLOSED_STATUSES = new Set(['Closed','Resolved','Verified','Rejected']);
        const now = new Date();
        const rowsWithFlags = rows.map(r => {
          const isOpen = !CLOSED_STATUSES.has(r.status);
          const isOverdue = !!r.due_date && new Date(r.due_date) < now && isOpen;
          const isBlocked = r.status === 'Blocked';
          return {
            ...r,
            can_intimate: isOpen && !!r.assignee_id && (isOverdue || isBlocked),
          };
        });
```

Then change the return to use `rowsWithFlags` instead of `rows`. Example:

Before:
```javascript
        return JSON.stringify({ count: rows.length, tickets: rows });
```

After:
```javascript
        return JSON.stringify({ count: rowsWithFlags.length, tickets: rowsWithFlags });
```

(The exact shape of the existing return object varies — preserve every existing key, only swap the tickets array.)

- [ ] **Step 3: Compile-check**

```bash
node -e "require('./lib/gpt-executor')"
```

Expected: no error.

- [ ] **Step 4: Commit**

```bash
git add lib/gpt-executor.js
git commit -m "feat(ai-tools): flag can_intimate on ticket rows; expose assignee_id"
```

---

## Task 21: Manual end-to-end smoke test

No code in this task — just run the real flow with real users and verify the contract.

- [ ] **Step 1: Provision a developer account**

In the admin dashboard at `/admin` (or directly via `POST /api/admin/dashboard-users`), create a test developer:
- `username`: `test_dev`
- `role`: `developer`
- `team`: same team as Upendra's test TL
- `telegram_id`: <your alt Telegram account ID>

- [ ] **Step 2: Developer /start and consent**

From the alt Telegram account, DM @ThinkingCodeBot `/start`.
Expected: you see the consent message.
Reply `/agree`.
Expected: "✓ Thanks — consent recorded."

- [ ] **Step 3: Originator triggers intimation by NL**

From Upendra's Telegram (or a TL account on same team), DM the bot:
`ask test_dev why TK-<pick an overdue ticket redmine_id> is overdue`

Expected:
- Bot replies with a preview card and `[Yes, send]` / `[Cancel]` buttons.
- Tap `[Yes, send]`.
- The alt account receives the intimation with `[Acknowledge]` `[Working on it]` `[Blocked]` buttons.
- Originator sees "✓ Sent to test_dev."

- [ ] **Step 4: Receiver responds**

From the alt (dev) account, tap `[Working on it]`.
Expected: Originator sees "test_dev on TK-… : *Working on it*".

Now type free text on the dev account: `will close by EOD today`.
Expected: Originator sees "test_dev replied on TK-…: 'will close by EOD today'".
In the DB, confirm a `commitments` row with `due_at` set to today 18:00 IST:

```bash
node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); getDb()\`SELECT id, promise_text, due_at, status FROM commitments ORDER BY id DESC LIMIT 5\`.then(r => console.log(r))"
```

- [ ] **Step 5: Force the 4h nudge**

```bash
node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); getDb()\`UPDATE bot_threads SET last_event_at = NOW() - INTERVAL '5 hours', status='sent' WHERE id = (SELECT id FROM bot_threads ORDER BY id DESC LIMIT 1)\`.then(() => console.log('ok'))"
```

Then trigger the dispatcher:

```bash
curl -i "http://localhost:3000/api/cron/phase1-tick?secret=$CRON_SECRET"
```

Expected: nudged=1 in the response; alt account receives "Gentle reminder…".

- [ ] **Step 6: Force the 24h close**

```bash
node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); getDb()\`UPDATE bot_threads SET created_at = NOW() - INTERVAL '25 hours', status='timeout_nudged' WHERE id = (SELECT id FROM bot_threads ORDER BY id DESC LIMIT 1)\`.then(() => console.log('ok'))"
```

Trigger dispatcher again. Originator receives the "hasn't responded in 24h" escalate/close card.

- [ ] **Step 7: Enrichment verification**

Wait for the next dispatcher tick (or call manually). Then:

```bash
node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); getDb()\`SELECT content, intent, entities FROM chat_history WHERE enriched_at IS NOT NULL ORDER BY id DESC LIMIT 5\`.then(r => console.log(JSON.stringify(r, null, 2)))"
```

Expected: `intent` populated (one of the INTENT_ENUM values), `entities` JSON present.

- [ ] **Step 8: Clean up test data**

```bash
node -e "require('dotenv').config({ path: '.env.local' }); const { getDb } = require('./lib/db'); const sql = getDb(); (async () => { await sql\`DELETE FROM commitments WHERE user_id = (SELECT id FROM dashboard_users WHERE username='test_dev')\`; await sql\`DELETE FROM bot_thread_events WHERE thread_id IN (SELECT id FROM bot_threads WHERE target_id = (SELECT id FROM dashboard_users WHERE username='test_dev'))\`; await sql\`DELETE FROM bot_threads WHERE target_id = (SELECT id FROM dashboard_users WHERE username='test_dev')\`; console.log('cleaned'); })()"
```

- [ ] **Step 9: Final commit (docs + any smoke-test tweaks discovered)**

If you had to tweak anything during the smoke test, commit it. Otherwise:

```bash
git log --oneline -15
```

to verify the Phase 1 commit chain looks clean.

---

## Done Criteria

Cross-check against the spec's Definition of Done:

- [ ] Manager on Telegram can tap an intimate button (or NL-ask) on an overdue ticket, confirm, and the developer receives the message with response buttons. ✔ Task 12-14, 20
- [ ] Developer's button tap or free-text reply is relayed to originator (+ CC'd TL) within 30 seconds. ✔ Task 12-13
- [ ] A commitment in free-text reply produces a `commitments` row and triggers followup DM at due time. ✔ Task 8-9, 13, 17
- [ ] Unanswered threads are nudged at 4h and closed at 24h with originator notified. ✔ Task 16
- [ ] Every new chat_history row has `role_at_time` populated; enrichment cron backfills `intent` and `entities` within 30 minutes. ✔ Task 10, 13, 18
- [ ] Developer consent gate: pre-consent replies are not relayed; post-`/agree`, they are. ✔ Task 15
- [ ] All unit tests pass. ✔ Tasks 4–8
- [ ] Manual e2e with Upendra → Vivek successful. ✔ Task 21

If any box above is unchecked, return to the referenced task before claiming completion.
