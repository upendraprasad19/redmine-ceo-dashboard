-- 001-extensions.sql
-- Enable required PostgreSQL extensions (idempotent)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
