-- 011-escalation.sql
-- Escalation log and decision trail for audit/governance

CREATE TABLE IF NOT EXISTS escalation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_triggered  TEXT NOT NULL,
  context         JSONB DEFAULT '{}',
  action_taken    TEXT,
  raised_by       INTEGER REFERENCES dashboard_users(id),
  escalated_to    INTEGER REFERENCES dashboard_users(id),
  actioned        BOOLEAN DEFAULT false,
  actioned_at     TIMESTAMPTZ,
  triggered_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_trail (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  made_by       INTEGER REFERENCES dashboard_users(id),
  project_id    UUID REFERENCES project_explorations(id),
  decision      TEXT NOT NULL,
  rationale     TEXT,
  data_used     JSONB DEFAULT '{}',
  outcome       TEXT,
  outcome_date  TIMESTAMPTZ,
  embedding     vector(1536),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
