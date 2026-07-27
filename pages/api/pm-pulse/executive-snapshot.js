import { getDb } from '../../../lib/db'

const { getCurrentUser } = require('../../../lib/auth')
const { send500 } = require('../../../lib/api-error')

const APPROVED_REDMINE_IDS = [
  2, 3, 5, 7, 14, 15, 16, 17, 18, 19, 20, 21, 23, 29, 34, 43, 44, 47, 49, 50, 51, 55, 56, 57, 60,
  61, 62, 63, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
]

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const sql = getDb()
    const isTeamLead = user.role === 'team_lead'
    const team = user.team
    const _closed = ['Closed', 'Resolved', 'Verified', 'Rejected']

    const [managers, projects, developers] = await Promise.all([
      // Manager-wise active ticket counts (grouped by Delivery Owner)
      isTeamLead
        ? sql`
            SELECT mu.name AS name, COUNT(DISTINCT i.id)::int AS count
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            JOIN users u ON u.id = i.assigned_to_id
            CROSS JOIN LATERAL unnest(i.delivery_owner_ids) AS oid
            JOIN users mu ON mu.id = oid
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND u.team = ${team}
              AND p.redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[])
            GROUP BY mu.name
            ORDER BY count DESC
            LIMIT 15`
        : sql`
            SELECT mu.name AS name, COUNT(DISTINCT i.id)::int AS count
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            CROSS JOIN LATERAL unnest(i.delivery_owner_ids) AS oid
            JOIN users mu ON mu.id = oid
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND p.redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[])
            GROUP BY mu.name
            ORDER BY count DESC
            LIMIT 15`,

      // Project-wise active ticket counts
      isTeamLead
        ? sql`
            SELECT p.name AS name, COUNT(i.id)::int AS count
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            JOIN users u ON u.id = i.assigned_to_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND u.team = ${team}
              AND p.redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[])
            GROUP BY p.name
            ORDER BY count DESC
            LIMIT 15`
        : sql`
            SELECT p.name AS name, COUNT(i.id)::int AS count
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND p.redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[])
            GROUP BY p.name
            ORDER BY count DESC
            LIMIT 15`,

      // Developer-wise active ticket counts
      isTeamLead
        ? sql`
            SELECT u.name AS name, COUNT(i.id)::int AS count
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND u.team = ${team}
              AND i.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))
            GROUP BY u.name
            ORDER BY count DESC
            LIMIT 15`
        : sql`
            SELECT u.name AS name, COUNT(i.id)::int AS count
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND i.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))
            GROUP BY u.name
            ORDER BY count DESC
            LIMIT 15`,
    ])

    res.status(200).json({ managers, projects, developers })
  } catch (err) {
    console.error(err)
    send500(res, err, 'executive-snapshot')
  }
}
