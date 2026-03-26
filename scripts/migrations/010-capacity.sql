-- 010-capacity.sql
-- Real-time capacity tracking and availability alerts

CREATE TABLE IF NOT EXISTS capacity_status (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER REFERENCES dashboard_users(id) UNIQUE,
  current_workload_pct  DECIMAL(5,2) DEFAULT 0,
  active_tickets        INT DEFAULT 0,
  available_capacity_pct DECIMAL(5,2) DEFAULT 100,
  predicted_free_date   DATE,
  predicted_free_pct    DECIMAL(5,2),
  days_underloaded      INT DEFAULT 0,
  alert_sent_today      BOOLEAN DEFAULT false,
  last_calculated       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS availability_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER REFERENCES dashboard_users(id),
  available_capacity DECIMAL(5,2),
  alert_type        TEXT CHECK (alert_type IN ('just_freed', 'becoming_free', 'underloaded')),
  suggested_tickets JSONB DEFAULT '[]',
  sent_to           INTEGER REFERENCES dashboard_users(id),
  actioned          BOOLEAN DEFAULT false,
  actioned_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
