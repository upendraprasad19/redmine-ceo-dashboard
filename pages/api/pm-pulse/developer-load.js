import { getDb } from '../../../lib/db';
const { getCurrentUser } = require('../../../lib/auth');

const EXPECTED_TIME_TEAMS = ['AI','DB','DevOps','JS/UI','Java','QA'];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const sql = getDb();
    const isTeamLead = user.role === 'team_lead';
    const team = user.team;

    const [load, timeLog] = await Promise.all([

      // Developer Load — active ticket counts per developer
      // total includes assigned tickets + tickets where user logged time
      // breakdown counts (New, In Progress, etc.) from assigned tickets only
      isTeamLead
        ? sql`
            SELECT
              u.id,
              u.name,
              u.team,
              (SELECT COUNT(*) FROM (
                SELECT 1 FROM issues i2 WHERE i2.assigned_to_id = u.id AND i2.status NOT IN ('Closed','Resolved','Verified','Rejected')
                UNION
                SELECT 1 FROM time_entries te2 JOIN issues i2 ON i2.id = te2.issue_id WHERE te2.user_id = u.id AND i2.status NOT IN ('Closed','Resolved','Verified','Rejected')
              ) combined)::int AS total,
              SUM(CASE WHEN i.status = 'New' THEN 1 ELSE 0 END)::int AS new_count,
              SUM(CASE WHEN i.status = 'In Progress' THEN 1 ELSE 0 END)::int AS in_progress_count,
              SUM(CASE WHEN i.status = 'Re Open' THEN 1 ELSE 0 END)::int AS reopen_count,
              SUM(CASE WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 1 ELSE 0 END)::int AS overdue,
              SUM(CASE WHEN i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3 THEN 1 ELSE 0 END)::int AS due_soon,
              SUM(CASE WHEN i.priority IN ('High','Critical') THEN 1 ELSE 0 END)::int AS high_priority,
              ROUND(AVG(CURRENT_DATE - i.created_at::date))::int AS avg_age_days,
              MAX(CURRENT_DATE - i.created_at::date)::int AS max_age_days,
              SUM(CASE WHEN i.created_at < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS tickets_7plus,
              SUM(CASE WHEN i.created_at < NOW() - INTERVAL '15 days' THEN 1 ELSE 0 END)::int AS tickets_15plus,
              MIN(i.created_at)::date AS oldest_ticket_date,
              MAX(i.updated_at)::date AS latest_update,
              STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS projects
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN projects p ON p.id = i.project_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND u.team = ${team}
            GROUP BY u.id, u.name, u.team
            ORDER BY u.name`
        : sql`
            SELECT
              u.id,
              u.name,
              u.team,
              (SELECT COUNT(*) FROM (
                SELECT 1 FROM issues i2 WHERE i2.assigned_to_id = u.id AND i2.status NOT IN ('Closed','Resolved','Verified','Rejected')
                UNION
                SELECT 1 FROM time_entries te2 JOIN issues i2 ON i2.id = te2.issue_id WHERE te2.user_id = u.id AND i2.status NOT IN ('Closed','Resolved','Verified','Rejected')
              ) combined)::int AS total,
              SUM(CASE WHEN i.status = 'New' THEN 1 ELSE 0 END)::int AS new_count,
              SUM(CASE WHEN i.status = 'In Progress' THEN 1 ELSE 0 END)::int AS in_progress_count,
              SUM(CASE WHEN i.status = 'Re Open' THEN 1 ELSE 0 END)::int AS reopen_count,
              SUM(CASE WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 1 ELSE 0 END)::int AS overdue,
              SUM(CASE WHEN i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3 THEN 1 ELSE 0 END)::int AS due_soon,
              SUM(CASE WHEN i.priority IN ('High','Critical') THEN 1 ELSE 0 END)::int AS high_priority,
              ROUND(AVG(CURRENT_DATE - i.created_at::date))::int AS avg_age_days,
              MAX(CURRENT_DATE - i.created_at::date)::int AS max_age_days,
              SUM(CASE WHEN i.created_at < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS tickets_7plus,
              SUM(CASE WHEN i.created_at < NOW() - INTERVAL '15 days' THEN 1 ELSE 0 END)::int AS tickets_15plus,
              MIN(i.created_at)::date AS oldest_ticket_date,
              MAX(i.updated_at)::date AS latest_update,
              STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS projects
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN projects p ON p.id = i.project_id
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
            GROUP BY u.id, u.name, u.team
            ORDER BY u.team, u.name`,

      // Developer Time Log — hours summary per developer
      isTeamLead
        ? sql`
            SELECT
              u.id,
              u.name,
              u.team,
              COALESCE(SUM(CASE WHEN te.spent_on = CURRENT_DATE THEN te.hours ELSE 0 END), 0)::float AS hours_today,
              COALESCE(SUM(CASE WHEN te.spent_on = CURRENT_DATE - 1 THEN te.hours ELSE 0 END), 0)::float AS hours_yesterday,
              COALESCE(SUM(CASE WHEN te.spent_on >= CURRENT_DATE - 6 THEN te.hours ELSE 0 END), 0)::float AS hours_last_7days,
              MAX(te.spent_on) AS last_log_date,
              (CURRENT_DATE - MAX(te.spent_on))::int AS days_since_last_log
            FROM users u
            LEFT JOIN time_entries te ON te.user_id = u.id
              AND te.spent_on >= CURRENT_DATE - 30
            WHERE u.active = true
              AND u.team = ${team}
              AND u.team = ANY(${EXPECTED_TIME_TEAMS}::text[])
            GROUP BY u.id, u.name, u.team
            ORDER BY u.name`
        : sql`
            SELECT
              u.id,
              u.name,
              u.team,
              COALESCE(SUM(CASE WHEN te.spent_on = CURRENT_DATE THEN te.hours ELSE 0 END), 0)::float AS hours_today,
              COALESCE(SUM(CASE WHEN te.spent_on = CURRENT_DATE - 1 THEN te.hours ELSE 0 END), 0)::float AS hours_yesterday,
              COALESCE(SUM(CASE WHEN te.spent_on >= CURRENT_DATE - 6 THEN te.hours ELSE 0 END), 0)::float AS hours_last_7days,
              MAX(te.spent_on) AS last_log_date,
              (CURRENT_DATE - MAX(te.spent_on))::int AS days_since_last_log
            FROM users u
            LEFT JOIN time_entries te ON te.user_id = u.id
              AND te.spent_on >= CURRENT_DATE - 30
            WHERE u.active = true
              AND u.team = ANY(${EXPECTED_TIME_TEAMS}::text[])
            GROUP BY u.id, u.name, u.team
            ORDER BY u.team, u.name`,
    ]);

    // Derive logging status
    const timeLogWithStatus = timeLog.map(row => ({
      ...row,
      logging_status:
        row.hours_last_7days === 0 ? 'No Log This Week'
        : row.days_since_last_log >= 3 ? `No Log in 3+ Days`
        : 'Logged Recently',
    }));

    res.status(200).json({ load, timeLog: timeLogWithStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
