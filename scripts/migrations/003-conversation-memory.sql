-- 003-conversation-memory.sql
-- Vector-backed conversation memory for AI context retrieval

CREATE TABLE IF NOT EXISTS conversation_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER REFERENCES dashboard_users(id) ON DELETE CASCADE,
  role        TEXT CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  embedding   vector(1536),
  metadata    JSONB DEFAULT '{}',
  source      TEXT DEFAULT 'dashboard' CHECK (source IN ('telegram', 'dashboard', 'slack')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_user_time
  ON conversation_memory (user_id, created_at DESC);

-- IVFFlat index for cosine similarity search on embeddings
-- Uses lists=100 for balanced recall/speed; adjust if row count grows significantly
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_conversation_memory_embedding'
  ) THEN
    CREATE INDEX idx_conversation_memory_embedding
      ON conversation_memory
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END
$$;

-- Memory summaries: compressed digests of older conversations
CREATE TABLE IF NOT EXISTS memory_summaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER REFERENCES dashboard_users(id) ON DELETE CASCADE,
  summary       TEXT NOT NULL,
  embedding     vector(1536),
  covers_from   TIMESTAMPTZ,
  covers_to     TIMESTAMPTZ,
  message_count INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_memory_summaries_embedding'
  ) THEN
    CREATE INDEX idx_memory_summaries_embedding
      ON memory_summaries
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END
$$;
