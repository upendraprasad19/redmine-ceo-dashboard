-- 005-vector-functions.sql
-- Semantic search functions for conversation memory and project Q&A

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding  vector(1536),
  match_user_id    INTEGER,
  match_threshold  FLOAT DEFAULT 0.75,
  match_count      INT   DEFAULT 5
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  metadata    JSONB,
  similarity  FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) AS similarity
  FROM conversation_memory
  WHERE user_id = match_user_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION match_project_qa(
  query_embedding  vector(1536),
  p_project_id     UUID,
  match_threshold  FLOAT DEFAULT 0.82,
  match_count      INT   DEFAULT 3
)
RETURNS TABLE (
  id          UUID,
  question    TEXT,
  answer      TEXT,
  answered_at TIMESTAMPTZ,
  similarity  FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    question,
    answer,
    answered_at,
    1 - (answer_embedding <=> query_embedding) AS similarity
  FROM project_qa
  WHERE project_id = p_project_id
    AND answer IS NOT NULL
    AND 1 - (answer_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
