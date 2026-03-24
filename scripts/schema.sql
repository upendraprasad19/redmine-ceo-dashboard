-- ================================================================
-- CEO DASHBOARD — NEON DB SCHEMA
-- Run this once in your Neon SQL editor
-- ================================================================

-- Users / Team members
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  redmine_id    INTEGER UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT,
  initials      TEXT,
  team          TEXT,
  role          TEXT,
  is_team_lead  BOOLEAN DEFAULT false,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id            SERIAL PRIMARY KEY,
  redmine_id    INTEGER UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'active',
  deadline      DATE,
  progress_pct  INTEGER DEFAULT 0,
  risk          TEXT DEFAULT 'low',   -- low | medium | high | critical
  manager_id    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Issues / Tickets
CREATE TABLE IF NOT EXISTS issues (
  id              SERIAL PRIMARY KEY,
  redmine_id      INTEGER UNIQUE,
  project_id      INTEGER REFERENCES projects(id),
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT,              -- New | In Progress | Review | Blocked | Closed
  priority        TEXT,              -- Low | Normal | High | Urgent | Immediate
  assigned_to_id  INTEGER REFERENCES users(id),
  author_id       INTEGER REFERENCES users(id),
  bz_id           TEXT,
  start_date      DATE,
  due_date        DATE,
  done_ratio      INTEGER DEFAULT 0,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Issue journals (comments / updates)
CREATE TABLE IF NOT EXISTS issue_journals (
  id            SERIAL PRIMARY KEY,
  redmine_id    INTEGER UNIQUE,
  issue_id      INTEGER REFERENCES issues(id),
  author_id     INTEGER REFERENCES users(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Time entries
CREATE TABLE IF NOT EXISTS time_entries (
  id            SERIAL PRIMARY KEY,
  redmine_id    INTEGER UNIQUE,
  issue_id      INTEGER REFERENCES issues(id),
  user_id       INTEGER REFERENCES users(id),
  project_id    INTEGER REFERENCES projects(id),
  hours         DECIMAL(6,2),
  activity      TEXT,
  comments      TEXT,
  spent_on      DATE NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Leave records (manual — Redmine doesn't track this)
CREATE TABLE IF NOT EXISTS leave_records (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id),
  leave_type    TEXT,               -- Annual | Sick | Unpaid | Maternity | Other
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  notes         TEXT,
  source        TEXT DEFAULT 'manual',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Issue team tracking (to know who from QA, DB, Java worked on what)
CREATE TABLE IF NOT EXISTS issue_team_history (
  id            SERIAL PRIMARY KEY,
  issue_id      INTEGER REFERENCES issues(id),
  team_name     TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id),
  assigned_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(issue_id, team_name)
);

-- Sync log (track last Redmine pull)
CREATE TABLE IF NOT EXISTS sync_log (
  id            SERIAL PRIMARY KEY,
  entity        TEXT NOT NULL,      -- users | projects | issues | time_entries
  last_synced   TIMESTAMPTZ DEFAULT NOW(),
  records_added INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'ok',
  error         TEXT
);

-- ── INDEXES for fast dashboard queries ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_issues_assigned   ON issues(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_issues_project    ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_status     ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_due_date   ON issues(due_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(spent_on);
CREATE INDEX IF NOT EXISTS idx_leave_user        ON leave_records(user_id);

-- ── VIEWS for dashboard queries ───────────────────────────────────

-- Daily time log status (used in Time Logs screen)
CREATE OR REPLACE VIEW daily_time_status AS
SELECT
  u.id, u.name, u.team,
  COALESCE(SUM(te.hours) FILTER (WHERE te.spent_on = CURRENT_DATE), 0) AS hours_today,
  CASE WHEN SUM(te.hours) FILTER (WHERE te.spent_on = CURRENT_DATE) > 0
    THEN true ELSE false END AS logged_today
FROM users u
LEFT JOIN time_entries te ON te.user_id = u.id
WHERE u.active = true
GROUP BY u.id, u.name, u.team;

-- Team workload summary (used in Overview)
CREATE OR REPLACE VIEW team_workload AS
SELECT
  u.team,
  COUNT(DISTINCT u.id)                          AS member_count,
  COUNT(i.id) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS open_tickets,
  ROUND(AVG(
    (SELECT COUNT(*) FROM issues i2
     WHERE i2.assigned_to_id = u.id
     AND i2.status NOT IN ('Closed','Resolved'))
  ))                                             AS avg_tickets_per_person
FROM users u
LEFT JOIN issues i ON i.assigned_to_id = u.id
WHERE u.active = true
GROUP BY u.team;

-- Person performance summary (used in People/drawer)
CREATE OR REPLACE VIEW person_performance AS
SELECT
  u.id, u.name, u.team, u.role, u.initials,
  COUNT(DISTINCT i_created.id)                  AS tickets_created,
  COUNT(DISTINCT i_worked.id)                   AS tickets_worked,
  COALESCE(SUM(te.hours) FILTER (
    WHERE te.spent_on >= date_trunc('month', CURRENT_DATE)
  ), 0)                                         AS hours_this_month
FROM users u
LEFT JOIN issues i_created ON i_created.author_id = u.id
LEFT JOIN issues i_worked  ON i_worked.assigned_to_id = u.id
LEFT JOIN time_entries te  ON te.user_id = u.id
WHERE u.active = true
GROUP BY u.id, u.name, u.team, u.role, u.initials;
