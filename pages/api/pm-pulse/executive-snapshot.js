import { getDb } from '../../../lib/db';
const { getCurrentUser } = require('../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const sql = getDb();
    const isTeamLead = user.role === 'team_lead';
    const team = user.team;
    const closed = ['Closed', 'Resolved', 'Verified', 'Rejected'];

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
            GROUP BY p.name
            ORDER BY count DESC
            LIMIT 15`
        : sql`
            SELECT p.name AS name, COUNT(i.id)::int AS count
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
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
            GROUP BY u.name
            ORDER BY count DESC
            LIMIT 15`
        : sql`
            SELECT u.name AS name, COUNT(i.id)::int AS count
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
            GROUP BY u.name
            ORDER BY count DESC
            LIMIT 15`,
    ]);

    res.status(200).json({ managers, projects, developers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
