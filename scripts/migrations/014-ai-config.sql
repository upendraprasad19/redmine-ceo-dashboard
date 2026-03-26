-- 014-ai-config.sql
-- AI provider configuration (admin-managed)

CREATE TABLE IF NOT EXISTS ai_config (
  id              SERIAL PRIMARY KEY,
  provider        TEXT NOT NULL DEFAULT 'openrouter' CHECK (provider IN ('openrouter', 'anthropic', 'openai')),
  api_key         TEXT NOT NULL,
  base_url        TEXT,
  default_model   TEXT NOT NULL,
  embedding_model TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
