-- 017-bot-personalization.sql
-- Adds onboarding state, briefing preferences, unknown query logging, and reminder scheduling

-- Add onboarding + briefing columns to dashboard_users
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT NULL;
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS briefing_time TIME DEFAULT '09:00';
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS briefing_days TEXT DEFAULT 'weekdays';

-- Table: bot_unknown_queries
-- Logs queries the bot couldn't answer so admin can see what users demand
CREATE TABLE IF NOT EXISTS bot_unknown_queries (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES dashboard_users(id),
  query_text      TEXT NOT NULL,
  user_role       TEXT,
  user_team       TEXT,
  suggested_alternative TEXT,
  frequency       INTEGER DEFAULT 1,
  status          TEXT DEFAULT 'unreviewed' CHECK (status IN ('unreviewed', 'planned', 'building', 'done')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_unknown_queries_text ON bot_unknown_queries (query_text);
CREATE INDEX IF NOT EXISTS idx_bot_unknown_queries_status ON bot_unknown_queries (status);
CREATE INDEX IF NOT EXISTS idx_bot_unknown_queries_freq ON bot_unknown_queries (frequency DESC);

-- Table: user_reminders
-- Stores reminders set by users via Telegram ("remind me about X tomorrow at 10am")
CREATE TABLE IF NOT EXISTS user_reminders (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES dashboard_users(id),
  telegram_id     TEXT NOT NULL,
  message         TEXT NOT NULL,
  remind_at       TIMESTAMPTZ NOT NULL,
  sent            BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_reminders_unsent ON user_reminders (remind_at) WHERE sent = false;
