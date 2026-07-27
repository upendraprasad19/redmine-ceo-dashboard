-- Migration 022: Add missing columns that were added outside the migration framework
-- delivery_owner_ids: per-ticket manager (enum-mapped at sync time)
-- email: dashboard user email for notifications
-- notification_channels: preferred notification delivery methods

ALTER TABLE issues ADD COLUMN IF NOT EXISTS delivery_owner_ids INTEGER[];
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS notification_channels TEXT[];
