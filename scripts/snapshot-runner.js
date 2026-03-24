/**
 * scripts/snapshot-runner.js
 *
 * Takes a daily snapshot of current team stats and inserts into daily_snapshots.
 * Idempotent — safe to run multiple times per day (uses ON CONFLICT DO UPDATE).
 *
 * Usage:
 *   node scripts/snapshot-runner.js
 *
 * Or imported and called:
 *   import { takeSnapshot } from './scripts/snapshot-runner.js';
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

// ─────────────────────────────────────────────────────────────────────────────

export async function takeSnapshot(sql) {
  const today = new Date().toISOString().split('T')[0];

  // Get all distinct active teams
  const teams = await sql`
    SELECT DISTINCT team
    FROM users
    WHERE active = true
      AND team IS NOT NULL
      AND team <> ''
    ORDER BY team
  `;

  if (teams.length === 0) {
    console.log('[snapshot] No active teams found.');
    return { teams: 0 };
  }

  let inserted = 0;

  for (const { team } of teams) {
    try {
      // Collect all member IDs for this team
      const members = await sql`
        SELECT id
        FROM users
        WHERE active = true
          AND team = ${team}
      `;
      const memberIds = members.map(m => m.id);

      if (memberIds.length === 0) continue;

      // open_tickets: open issues assigned to team members
      const [{ open_tickets }] = await sql`
        SELECT COUNT(*) AS open_tickets
        FROM issues
        WHERE assigned_to_id = ANY(${memberIds})
          AND status NOT IN ('Closed', 'Resolved')
      `;

      // overdue_tickets: open issues with due_date < today
      const [{ overdue_tickets }] = await sql`
        SELECT COUNT(*) AS overdue_tickets
        FROM issues
        WHERE assigned_to_id = ANY(${memberIds})
          AND status NOT IN ('Closed', 'Resolved')
          AND due_date < ${today}::date
      `;

      // blocked_tickets: issues with status = 'Blocked'
      const [{ blocked_tickets }] = await sql`
        SELECT COUNT(*) AS blocked_tickets
        FROM issues
        WHERE assigned_to_id = ANY(${memberIds})
          AND status = 'Blocked'
      `;

      // critical_tickets: open issues with priority IN ('High','Critical')
      const [{ critical_tickets }] = await sql`
        SELECT COUNT(*) AS critical_tickets
        FROM issues
        WHERE assigned_to_id = ANY(${memberIds})
          AND status NOT IN ('Closed', 'Resolved')
          AND priority IN ('High', 'Critical')
      `;

      // closed_today: issues closed today
      const [{ closed_today }] = await sql`
        SELECT COUNT(*) AS closed_today
        FROM issues
        WHERE assigned_to_id = ANY(${memberIds})
          AND closed_at::date = ${today}::date
      `;

      // hours_logged: sum of time_entries.hours for spent_on = today
      const [{ hours_logged }] = await sql`
        SELECT COALESCE(SUM(hours), 0) AS hours_logged
        FROM time_entries
        WHERE user_id = ANY(${memberIds})
          AND spent_on = ${today}::date
      `;

      // members_logged: distinct users who logged time today
      const [{ members_logged }] = await sql`
        SELECT COUNT(DISTINCT user_id) AS members_logged
        FROM time_entries
        WHERE user_id = ANY(${memberIds})
          AND spent_on = ${today}::date
      `;

      // total_members: active users in this team
      const total_members = memberIds.length;

      // avg_done_ratio: avg done_ratio of open tickets
      const [{ avg_done_ratio }] = await sql`
        SELECT COALESCE(AVG(done_ratio), 0) AS avg_done_ratio
        FROM issues
        WHERE assigned_to_id = ANY(${memberIds})
          AND status NOT IN ('Closed', 'Resolved')
      `;

      // Upsert into daily_snapshots
      await sql`
        INSERT INTO daily_snapshots (
          snapshot_date,
          team,
          open_tickets,
          overdue_tickets,
          blocked_tickets,
          critical_tickets,
          closed_today,
          hours_logged,
          members_logged,
          total_members,
          avg_done_ratio
        ) VALUES (
          ${today}::date,
          ${team},
          ${parseInt(open_tickets, 10)},
          ${parseInt(overdue_tickets, 10)},
          ${parseInt(blocked_tickets, 10)},
          ${parseInt(critical_tickets, 10)},
          ${parseInt(closed_today, 10)},
          ${parseFloat(hours_logged)},
          ${parseInt(members_logged, 10)},
          ${total_members},
          ${parseFloat(avg_done_ratio)}
        )
        ON CONFLICT (snapshot_date, team) DO UPDATE SET
          open_tickets     = EXCLUDED.open_tickets,
          overdue_tickets  = EXCLUDED.overdue_tickets,
          blocked_tickets  = EXCLUDED.blocked_tickets,
          critical_tickets = EXCLUDED.critical_tickets,
          closed_today     = EXCLUDED.closed_today,
          hours_logged     = EXCLUDED.hours_logged,
          members_logged   = EXCLUDED.members_logged,
          total_members    = EXCLUDED.total_members,
          avg_done_ratio   = EXCLUDED.avg_done_ratio
      `;

      console.log(`[snapshot] Team "${team}": open=${open_tickets}, overdue=${overdue_tickets}, blocked=${blocked_tickets}, critical=${critical_tickets}, closed=${closed_today}, hours=${parseFloat(hours_logged).toFixed(1)}, members_logged=${members_logged}/${total_members}`);
      inserted++;
    } catch (err) {
      console.error(`[snapshot] Error processing team "${team}":`, err.message);
    }
  }

  console.log(`[snapshot] Done. Snapshotted ${inserted}/${teams.length} teams for ${today}.`);
  return { teams: inserted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run as main

if (process.argv[1] && process.argv[1].endsWith('snapshot-runner.js')) {
  const sql = neon(process.env.DATABASE_URL);

  takeSnapshot(sql)
    .then(result => {
      console.log(`\nSnapshot complete. Teams snapshotted: ${result.teams}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('\nSnapshot failed:', err.message);
      process.exit(1);
    });
}
