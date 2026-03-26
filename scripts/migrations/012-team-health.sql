-- 012-team-health.sql
-- Weekly team health scores

CREATE TABLE IF NOT EXISTS team_health (
  id                        SERIAL PRIMARY KEY,
  team                      TEXT NOT NULL,
  week_start                DATE NOT NULL,
  on_time_delivery_rate     DECIMAL(5,4) DEFAULT 0,
  hours_consistency         DECIMAL(5,4) DEFAULT 0,
  blocker_resolution_speed  DECIMAL(8,2) DEFAULT 0,
  reopen_rate               DECIMAL(5,4) DEFAULT 0,
  overall_score             INT DEFAULT 0,
  trend                     TEXT DEFAULT 'stable' CHECK (trend IN ('rising', 'stable', 'declining')),
  raw_data                  JSONB DEFAULT '{}',
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team, week_start)
);
