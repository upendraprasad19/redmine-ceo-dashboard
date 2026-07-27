const { neon } = require('@neondatabase/serverless')
require('dotenv').config({ path: '.env.local' })
const sql = neon(process.env.DATABASE_URL)

async function migrate() {
  try {
    console.log('Migrating schema...')

    // Add columns
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_team_lead BOOLEAN DEFAULT false`
    console.log('[+] Added is_team_lead to users')

    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id)`
    console.log('[+] Added manager_id to projects')

    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS bz_id TEXT`
    console.log('[+] Added bz_id to issues')

    await sql`ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`
    console.log('[+] Added source to leave_records')

    // Create new tables
    await sql`
      CREATE TABLE IF NOT EXISTS issue_team_history (
        id SERIAL PRIMARY KEY,
        issue_id INTEGER REFERENCES issues(id),
        team_name TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id),
        assigned_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(issue_id, team_name)
      )
    `
    console.log('[+] Created issue_team_history')

    console.log('Migration complete!')
  } catch (err) {
    console.error('Migration failed:', err)
  }
}

migrate()
