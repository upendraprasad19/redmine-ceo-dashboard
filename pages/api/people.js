import { getDb } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();

    const people = await sql`
      SELECT
        u.id, u.name, u.team, u.role, u.initials,
        (SELECT COUNT(*) FROM issues i WHERE i.author_id = u.id) AS tickets_created,
        (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id) AS tickets_worked,
        (SELECT COALESCE(SUM(hours), 0) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on >= date_trunc('month', CURRENT_DATE)) AS hours_this_month,
        CASE WHEN lr.id IS NOT NULL THEN lr.leave_type ELSE NULL END AS leave
      FROM users u
      LEFT JOIN leave_records lr
        ON lr.user_id = u.id
        AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
      WHERE u.active = true
      ORDER BY u.team, u.name
    `;

    res.status(200).json({ people });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
