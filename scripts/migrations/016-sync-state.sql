-- Stores key/value state for background sync jobs
CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
