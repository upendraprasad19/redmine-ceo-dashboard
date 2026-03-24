import { getDb } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();

    const [kpis, projects, workload, alerts] = await Promise.all([
      // KPIs
      sql`
        SELECT
          (SELECT COUNT(*) FROM users WHERE active = true) AS headcount,
          (SELECT COUNT(*) FROM leave_records
           WHERE CURRENT_DATE BETWEEN start_date AND end_date) AS on_leave,
          (SELECT COUNT(*) FROM issues 
           WHERE due_date IS NOT NULL 
           AND due_date < CURRENT_DATE 
           AND status NOT IN ('Closed', 'Resolved')) AS overdue_tickets,
          (SELECT COUNT(*) FROM daily_time_status WHERE logged_today = false) AS no_time_log
      `,

      // Projects with deadline + progress
      sql`
        SELECT name, deadline, progress_pct, risk, status
        FROM projects
        WHERE status = 'active'
        ORDER BY deadline ASC NULLS LAST
      `,

      // Workload by team
      sql`
        SELECT
          u.team,
          COUNT(DISTINCT u.id) AS member_count,
          (SELECT COUNT(*) FROM issues i2 
           JOIN users u2 ON u2.id = i2.assigned_to_id 
           WHERE u2.team = u.team AND i2.status NOT IN ('Closed','Resolved')) AS open_tickets,
          ROUND(AVG(
            (SELECT COUNT(*) FROM issues i3 
             WHERE i3.assigned_to_id = u.id AND i3.status NOT IN ('Closed','Resolved'))
          )) AS avg_tickets_per_person
        FROM users u
        WHERE u.active = true
        GROUP BY u.team
        ORDER BY u.team
      `,

      // Alert items — overdue tickets
      sql`
        SELECT i.id, i.title, u.name AS assigned_to, i.due_date
        FROM issues i
        LEFT JOIN users u ON u.id = i.assigned_to_id
        WHERE i.due_date IS NOT NULL 
        AND i.due_date < CURRENT_DATE 
        AND i.status NOT IN ('Closed', 'Resolved')
        ORDER BY i.due_date ASC
        LIMIT 5
      `,
    ]);

    res.status(200).json({
      kpis: kpis[0],
      projects,
      workload,
      alerts,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
