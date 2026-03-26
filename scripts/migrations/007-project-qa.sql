-- 007-project-qa.sql
-- Questions and answers attached to project explorations

CREATE TABLE IF NOT EXISTS project_qa (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID REFERENCES project_explorations(id) ON DELETE CASCADE,
  asked_by            INTEGER REFERENCES dashboard_users(id),
  question            TEXT NOT NULL,
  question_embedding  vector(1536),
  asked_at            TIMESTAMPTZ DEFAULT NOW(),
  answered_by         INTEGER REFERENCES dashboard_users(id),
  answer              TEXT,
  answer_embedding    vector(1536),
  answered_at         TIMESTAMPTZ,
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'archived')),
  view_count          INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_project_qa_project_status
  ON project_qa (project_id, status);

CREATE INDEX IF NOT EXISTS idx_project_qa_asked_by_time
  ON project_qa (asked_by, asked_at DESC);
