-- ================================================================
-- TELEGRAM BOT & NOTIFICATION SYSTEM — MIGRATION
-- Run this once in your Neon SQL editor
-- ================================================================

-- Add Telegram fields to existing users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_chat_id   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_username  TEXT;

-- Multi-step conversation state for bot wizards (e.g. leave application)
CREATE TABLE IF NOT EXISTS telegram_sessions (
  id           SERIAL PRIMARY KEY,
  chat_id      TEXT NOT NULL UNIQUE,
  state        TEXT NOT NULL DEFAULT 'idle',   -- idle | registering | leave_date | leave_type | leave_reason | leave_confirm
  context      JSONB DEFAULT '{}',             -- wizard data collected so far
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Leave requests submitted via Telegram bot
CREATE TABLE IF NOT EXISTS leave_requests (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  leave_type   TEXT NOT NULL,                  -- Annual | Sick | Unpaid | Maternity | Other
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Notification log to prevent duplicate sends
CREATE TABLE IF NOT EXISTS notification_log (
  id           SERIAL PRIMARY KEY,
  type         TEXT NOT NULL,                  -- due_ticket | timelog_reminder
  ref_id       INTEGER,                        -- issue_id or user_id depending on type
  channel      TEXT NOT NULL,                  -- telegram | email
  sent_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  sent_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(type, ref_id, channel, sent_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leave_requests_user   ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_notification_log_type ON notification_log(type, sent_at);


