-- 006-project-explorations.sql
-- Strategic project explorations managed by the CEO

CREATE TABLE IF NOT EXISTS project_explorations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by        INTEGER REFERENCES dashboard_users(id),
  name              TEXT NOT NULL,
  description       TEXT,
  vision            TEXT,
  status            TEXT DEFAULT 'conceptual' CHECK (status IN ('conceptual', 'in_discussion', 'approved', 'killed')),
  cost_structure    JSONB DEFAULT '{}',
  timeline          JSONB DEFAULT '{}',
  team_requirements JSONB DEFAULT '{}',
  risks             JSONB DEFAULT '[]',
  opportunities     JSONB DEFAULT '[]',
  decisions_made    JSONB DEFAULT '[]',
  shared_with       INTEGER[] DEFAULT '{}',
  embedding         vector(1536),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
