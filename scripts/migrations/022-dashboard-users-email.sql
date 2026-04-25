-- 022-dashboard-users-email.sql
-- Formalize the dashboard_users.email column that the admin endpoint and
-- forgot-password flow already assume exists (originally added via manual
-- SQL outside the migration history). Idempotent via IF NOT EXISTS.

ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_dashboard_users_email_lower ON dashboard_users (LOWER(email));
