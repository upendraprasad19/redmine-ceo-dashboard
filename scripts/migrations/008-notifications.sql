-- 008-notifications.sql
-- CEO notification center

CREATE TABLE IF NOT EXISTS ceo_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN (
                'new_question', 'project_accessed', 'unanswered_backlog',
                'performance_alert', 'capacity_alert', 'deadline_risk'
              )),
  from_user   INTEGER REFERENCES dashboard_users(id),
  project_id  UUID REFERENCES project_explorations(id),
  qa_id       UUID REFERENCES project_qa(id),
  message     TEXT NOT NULL,
  action_url  TEXT,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_notifications_unread
  ON ceo_notifications (is_read, created_at DESC);
