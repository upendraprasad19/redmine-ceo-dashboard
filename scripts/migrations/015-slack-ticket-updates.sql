-- 015-slack-ticket-updates.sql
-- Tracks ticket status changes made by developers via Slack standup cards.
-- These are local updates in Neon (NOT pushed to Redmine).

CREATE TABLE IF NOT EXISTS slack_ticket_updates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id                    INTEGER NOT NULL,
  redmine_id                  INTEGER,
  previous_status             TEXT,
  new_status                  TEXT NOT NULL,
  updated_by_slack_id         TEXT,
  updated_by_dashboard_user_id INTEGER REFERENCES dashboard_users(id),
  source                      TEXT DEFAULT 'standup_card',
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_ticket_updates_issue
  ON slack_ticket_updates (issue_id);

CREATE INDEX IF NOT EXISTS idx_slack_ticket_updates_user
  ON slack_ticket_updates (updated_by_dashboard_user_id);

CREATE INDEX IF NOT EXISTS idx_slack_ticket_updates_created
  ON slack_ticket_updates (created_at DESC);
