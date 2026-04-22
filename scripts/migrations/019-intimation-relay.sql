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
