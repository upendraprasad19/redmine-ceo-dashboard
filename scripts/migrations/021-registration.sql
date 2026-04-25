-- 021-registration.sql
-- Self-registration: pending_registrations (OTP/Telegram verification),
-- access_requests (unlisted-user path), register_rate_limit (abuse control)

CREATE TABLE IF NOT EXISTS pending_registrations (
  id                     SERIAL PRIMARY KEY,
  code                   TEXT UNIQUE NOT NULL,
  linked_redmine_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username               TEXT NOT NULL,
  password_hash          TEXT NOT NULL,
  email                  TEXT NOT NULL,
  email_verified         BOOLEAN NOT NULL DEFAULT false,
  email_otp              TEXT,
  email_otp_expires_at   TIMESTAMPTZ,
  email_otp_attempts     INTEGER NOT NULL DEFAULT 0,
  telegram_id            BIGINT,
  telegram_verified_at   TIMESTAMPTZ,
  verified_channel       TEXT CHECK (verified_channel IN ('telegram','email')),
  status                 TEXT NOT NULL DEFAULT 'awaiting_verification'
                           CHECK (status IN ('awaiting_verification','ready','consumed','expired')),
  expires_at             TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_status ON pending_registrations (status);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_expires_at ON pending_registrations (expires_at);
-- Only one live pending registration per email or per Redmine user; completed / expired rows don't block re-attempts
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_active_email
  ON pending_registrations (LOWER(email)) WHERE status = 'awaiting_verification';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_active_redmine
  ON pending_registrations (linked_redmine_user_id) WHERE status = 'awaiting_verification';

CREATE TABLE IF NOT EXISTS access_requests (
  id           SERIAL PRIMARY KEY,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  team         TEXT,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected','resolved')),
  reviewed_by  INTEGER REFERENCES dashboard_users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests (status);
CREATE INDEX IF NOT EXISTS idx_access_requests_email_lower ON access_requests (LOWER(email));

CREATE TABLE IF NOT EXISTS register_rate_limit (
  ip            TEXT NOT NULL,
  bucket        TEXT NOT NULL,     -- 'start' | 'request_access' | 'verify_email' | 'send_email_otp'
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, bucket)
);
