-- 013-pinned-insights.sql
-- AI-generated pinned insights for the dashboard

CREATE TABLE IF NOT EXISTS pinned_insights (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES dashboard_users(id) ON DELETE CASCADE,
  insight_type  TEXT NOT NULL CHECK (insight_type IN (
                  'overdue', 'no_timelog', 'capacity', 'deadline_risk',
                  'velocity', 'health', 'general'
                )),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  severity      TEXT DEFAULT 'info' CHECK (severity IN ('critical', 'warning', 'info')),
  data          JSONB DEFAULT '{}',
  dismissed     BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pinned_insights_user_active
  ON pinned_insights (user_id, dismissed, created_at DESC);
