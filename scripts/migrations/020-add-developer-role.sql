-- 020-add-developer-role.sql
-- Extend dashboard_users.role to include 'developer' (for self-registered non-lead staff)

ALTER TABLE dashboard_users DROP CONSTRAINT IF EXISTS dashboard_users_role_check;
ALTER TABLE dashboard_users
  ADD CONSTRAINT dashboard_users_role_check
  CHECK (role IN ('manager', 'team_lead', 'developer'));
