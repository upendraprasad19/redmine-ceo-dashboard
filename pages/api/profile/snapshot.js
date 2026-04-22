import { getDb } from '../../../lib/db';
const { getCurrentUser } = require('../../../lib/auth');

const EXPECTED_TIME_TEAMS = ['AI','DB','DevOps','JS/UI','Java','QA'];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const sql = getDb();

    // Full profile record (identity + prefs + channels)
    const meRows = await sql`
      SELECT id, username, display_name, role, team, email, telegram_id,
             briefing_time, briefing_days, morning_briefing, notification_channels,
             linked_redmine_user_id
      FROM dashboard_users WHERE id = ${user.id} LIMIT 1
    `;
    const me = meRows[0] || null;
    if (!me) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'manager') {
      const [kpis, topRisk] = await Promise.all([
        sql`
          SELECT
            (SELECT COUNT(*) FROM issues WHERE status NOT IN ('Closed','Resolved','Verified','Rejected'))::int AS open_tickets,
            (SELECT COUNT(*) FROM issues
              WHERE status NOT IN ('Closed','Resolved','Verified','Rejected')
                AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue,
            (SELECT COUNT(*) FROM daily_time_status dts
              WHERE dts.logged_today = false
                AND dts.team = ANY(${EXPECTED_TIME_TEAMS}::text[]))::int AS no_time_log_today
        `,
        sql`
          SELECT p.name, COUNT(*)::int AS overdue_count
          FROM issues i JOIN projects p ON p.id = i.project_id
          WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
            AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE
          GROUP BY p.name ORDER BY overdue_count DESC LIMIT 3
        `,
      ]);
      return res.status(200).json({
        me,
        snapshot: { scope: 'manager', ...kpis[0], topRisk },
      });
    }

    // team_lead
    const team = user.team;
    const [kpis, topDev] = await Promise.all([
      sql`
        SELECT
          (SELECT COUNT(*) FROM users WHERE active = true AND team = ${team})::int AS team_size,
          (SELECT COUNT(*) FROM leave_records lr
            JOIN users u ON u.id = lr.user_id
            WHERE u.team = ${team}
              AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date)::int AS on_leave_today,
          (SELECT COUNT(*) FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            WHERE u.team = ${team}
              AND i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE)::int AS team_overdue
      `,
      sql`
        SELECT u.name, COUNT(*)::int AS open_count
        FROM issues i JOIN users u ON u.id = i.assigned_to_id
        WHERE u.team = ${team}
          AND i.status NOT IN ('Closed','Resolved','Verified','Rejected')
        GROUP BY u.name ORDER BY open_count DESC LIMIT 3
      `,
    ]);
    return res.status(200).json({
      me,
      snapshot: { scope: 'team_lead', team, ...kpis[0], topDev },
    });
  } catch (err) {
    console.error('profile/snapshot error:', err);
    res.status(500).json({ error: err.message });
  }
}
