/**
 * scripts/migrate.js
 * One-time schema migration — run once then safe to re-run (all IF NOT EXISTS).
 * node scripts/migrate.js
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('Running migrations...\n');

  // ── 1. Conversation history (AI chat memory per Telegram user) ─────────────
  await sql`
    CREATE TABLE IF NOT EXISTS conversation_history (
      id           SERIAL PRIMARY KEY,
      telegram_id  BIGINT NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content      TEXT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_conv_telegram_id ON conversation_history(telegram_id, created_at DESC)`;
  console.log('✓ conversation_history');

  // ── 2. Daily snapshots (trend data per team per day) ──────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS daily_snapshots (
      snapshot_date   DATE NOT NULL,
      team            TEXT NOT NULL,
      open_tickets    INTEGER DEFAULT 0,
      overdue_tickets INTEGER DEFAULT 0,
      blocked_tickets INTEGER DEFAULT 0,
      critical_tickets INTEGER DEFAULT 0,
      closed_today    INTEGER DEFAULT 0,
      hours_logged    DECIMAL(8,2) DEFAULT 0,
      members_logged  INTEGER DEFAULT 0,
      total_members   INTEGER DEFAULT 0,
      avg_done_ratio  DECIMAL(5,2) DEFAULT 0,
      PRIMARY KEY (snapshot_date, team)
    )
  `;
  console.log('✓ daily_snapshots');

  // ── 3. Anomaly alerts (dedup + track sent alerts) ─────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS anomaly_alerts (
      id           SERIAL PRIMARY KEY,
      alert_type   TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    INTEGER,
      message      TEXT NOT NULL,
      severity     TEXT DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
      sent_at      TIMESTAMPTZ DEFAULT NOW(),
      resolved_at  TIMESTAMPTZ,
      UNIQUE(alert_type, entity_id, entity_type)
    )
  `;
  console.log('✓ anomaly_alerts');

  // ── 4. Add telegram_chat_id to users if missing ───────────────────────────
  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT
  `;
  console.log('✓ users.telegram_chat_id');

  // ── 5. telegram_sessions table if missing ─────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_sessions (
      chat_id    TEXT PRIMARY KEY,
      state      TEXT DEFAULT 'idle',
      context    JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✓ telegram_sessions');

  console.log('\n✅ All migrations complete.');
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
