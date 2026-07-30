-- Migration 024: Switch performance_snapshots.user_id from dashboard_users(id) to users(id)
-- The performance cron scores ALL Redmine users, not just those with dashboard_users entries.
-- Backfills existing rows via dashboard_users.linked_redmine_user_id.

-- 1. Add temporary column
ALTER TABLE performance_snapshots ADD COLUMN user_id_new INTEGER;

-- 2. Backfill: map dashboard_users.id → users.id via linked_redmine_user_id
UPDATE performance_snapshots ps
SET user_id_new = du.linked_redmine_user_id
FROM dashboard_users du
WHERE ps.user_id = du.id
  AND du.linked_redmine_user_id IS NOT NULL;

-- 3. Drop old FK, drop old column, rename new, add FK
ALTER TABLE performance_snapshots DROP CONSTRAINT IF EXISTS performance_snapshots_user_id_fkey;
ALTER TABLE performance_snapshots DROP COLUMN user_id;
ALTER TABLE performance_snapshots RENAME COLUMN user_id_new TO user_id;

-- 4. Add NOT NULL + FK to users(id)
ALTER TABLE performance_snapshots ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE performance_snapshots ADD CONSTRAINT performance_snapshots_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id);

-- 5. Recreate UNIQUE constraint (was on old user_id)
ALTER TABLE performance_snapshots DROP CONSTRAINT IF EXISTS performance_snapshots_user_id_snapshot_date_period_key;
ALTER TABLE performance_snapshots ADD CONSTRAINT performance_snapshots_user_id_snapshot_date_period_key
  UNIQUE (user_id, snapshot_date, period);

-- 6. Recreate index
DROP INDEX IF EXISTS idx_perf_snapshots_user_date;
CREATE INDEX idx_perf_snapshots_user_date ON performance_snapshots (user_id, snapshot_date DESC);
