-- 009-performance.sql
-- Performance scoring snapshots and granular events

CREATE TABLE IF NOT EXISTS performance_snapshots (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   INTEGER REFERENCES dashboard_users(id),
  snapshot_date             DATE NOT NULL,
  period                    TEXT DEFAULT 'daily' CHECK (period IN ('daily', 'weekly', 'monthly')),
  tickets_closed            INT DEFAULT 0,
  tickets_in_progress       INT DEFAULT 0,
  tickets_overdue           INT DEFAULT 0,
  tickets_reopened          INT DEFAULT 0,
  hours_logged              DECIMAL(6,2) DEFAULT 0,
  avg_resolution_time_hrs   DECIMAL(8,2),
  avg_first_action_time_hrs DECIMAL(8,2),
  reopen_rate               DECIMAL(5,4) DEFAULT 0,
  deadline_hit_rate         DECIMAL(5,4) DEFAULT 0,
  output_score              INT DEFAULT 0,
  speed_score               INT DEFAULT 0,
  quality_score             INT DEFAULT 0,
  reliability_score         INT DEFAULT 0,
  collaboration_score       INT DEFAULT 0,
  overall_score             INT DEFAULT 0,
  score_delta               DECIMAL(5,2) DEFAULT 0,
  trend                     TEXT DEFAULT 'stable' CHECK (trend IN ('rising', 'stable', 'declining')),
  raw_data                  JSONB DEFAULT '{}',
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, snapshot_date, period)
);

CREATE TABLE IF NOT EXISTS performance_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER REFERENCES dashboard_users(id),
  event_type    TEXT NOT NULL CHECK (event_type IN (
                  'ticket_closed', 'ticket_reopened',
                  'blocker_raised', 'blocker_resolved',
                  'deadline_missed', 'deadline_hit',
                  'update_proactive', 'update_chased',
                  'scope_added', 'hours_logged', 'hours_missing'
                )),
  ticket_id     TEXT,
  event_data    JSONB DEFAULT '{}',
  impact_score  DECIMAL(5,2) DEFAULT 0,
  occurred_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perf_events_user_time
  ON performance_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_perf_events_type_time
  ON performance_events (event_type, occurred_at DESC);
