-- 018-morning-briefing-column.sql
-- Adds morning_briefing as a direct column for simpler querying
-- (also stored in behavior_profile JSONB for backwards compat)

ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS morning_briefing TEXT DEFAULT 'none';
