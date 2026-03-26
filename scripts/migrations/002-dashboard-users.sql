-- 002-dashboard-users.sql
-- Dashboard login + bot identity + AI personalization table

CREATE TABLE IF NOT EXISTS dashboard_users (
  id                    SERIAL PRIMARY KEY,
  username              TEXT UNIQUE NOT NULL,
  password_hash         TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('manager', 'team_lead')),
  team                  TEXT,
  linked_redmine_user_id INTEGER REFERENCES users(id),
  telegram_id           BIGINT UNIQUE,
  slack_id              TEXT UNIQUE,
  behavior_profile      JSONB DEFAULT '{}',
  top_concerns          TEXT[] DEFAULT '{}',
  response_style        TEXT DEFAULT 'concise',
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
