-- 004-chat-history.sql
-- Raw chat log for Intelligence tab (persistent, no embeddings)

CREATE TABLE IF NOT EXISTS chat_history (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES dashboard_users(id) ON DELETE CASCADE,
  role        TEXT CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_user_time
  ON chat_history (user_id, created_at DESC);
