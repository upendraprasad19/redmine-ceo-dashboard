-- Migration 020: Schema migration tracking table
-- Enables idempotent migration runs by recording which files have been applied.

CREATE TABLE IF NOT EXISTS _schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
