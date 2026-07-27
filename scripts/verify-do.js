import { config } from 'dotenv'

config({ path: `${process.cwd()}/.env.local` })

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

async function verify() {
  const tickets =
    await sql`SELECT i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, p.name AS project_name, u1.name AS assigned_to, u1.team, do_.names AS manager FROM issues i LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN users u1 ON u1.id = i.assigned_to_id LEFT JOIN LATERAL (SELECT STRING_AGG(u.name, ', ' ORDER BY u.name) AS names FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users u ON u.id = oid) do_ ON true WHERE p.name = 'iCLAIMS 2.0' AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected') ORDER BY i.updated_at DESC LIMIT 10`
  console.log('=== iCLAIMS 2.0 Active Tickets ===')
  tickets.forEach((t) =>
    console.log(
      '#' +
        t.redmine_id +
        ' | ' +
        t.status +
        ' | ' +
        t.title.slice(0, 55) +
        ' | Manager: ' +
        (t.manager || '—') +
        ' | Team: ' +
        (t.team || '—'),
    ),
  )
  const s =
    await sql`SELECT COUNT(*) as total, COUNT(i.delivery_owner_ids) as with_do FROM issues i JOIN projects p ON p.id=i.project_id WHERE p.name='iCLAIMS 2.0' AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')`
  console.log(`\nSummary: ${s[0].total} active, ${s[0].with_do} with manager`)
}
verify()
