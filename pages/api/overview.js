import { getDb } from '../../lib/db';
const { getCurrentUser } = require('../../lib/auth');

const EXPECTED_TIME_TEAMS = ['AI','DB','DevOps','JS/UI','Java','QA'];
const APPROVED_REDMINE_IDS = [2,3,5,7,14,15,16,17,18,19,20,21,23,29,34,43,44,47,49,50,51,55,56,57,60,61,62,63,65,67,68,69,70,71,72,73,74,75,76];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const sql = getDb();
    const isTeamLead = user.role === 'team_lead';
    const team = user.team;

    const [kpis, projects, workload, alerts] = await Promise.all([
      // KPIs — scoped by team for team_leads
      isTeamLead
        ? sql`
            SELECT
              (SELECT COUNT(*) FROM users WHERE active = true AND team = ${team}) AS headcount,
              (SELECT COUNT(*) FROM leave_records lr
               JOIN users u ON u.id = lr.user_id
               WHERE u.team = ${team}
               AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date) AS on_leave,
              (SELECT COUNT(*) FROM issues i
               JOIN users u ON u.id = i.assigned_to_id
               WHERE u.team = ${team}
               AND i.due_date IS NOT NULL
               AND i.due_date < CURRENT_DATE
               AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')) AS overdue_tickets,
              (SELECT COUNT(*) FROM daily_time_status dts
               JOIN users u ON u.id = dts.user_id
               WHERE u.team = ${team}
               AND u.team = ANY(${EXPECTED_TIME_TEAMS}::text[])
               AND dts.logged_today = false) AS no_time_log,
              (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te
               JOIN users u ON u.id = te.user_id
               WHERE u.team = ${team}
               AND te.spent_on = CURRENT_DATE - 1) AS yesterday_hours,
              (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te
               JOIN users u ON u.id = te.user_id
               WHERE u.team = ${team}
               AND te.spent_on = CURRENT_DATE) AS today_hours
          `
        : sql`
            SELECT
              (SELECT COUNT(*) FROM users WHERE active = true AND team IS NOT NULL) AS headcount,
              (SELECT COUNT(*) FROM leave_records
               WHERE CURRENT_DATE BETWEEN start_date AND end_date) AS on_leave,
              (SELECT COUNT(*) FROM issues
               WHERE due_date IS NOT NULL
               AND due_date < CURRENT_DATE
               AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
               AND project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))) AS overdue_tickets,
              (SELECT COUNT(*) FROM daily_time_status dts
               WHERE dts.logged_today = false
               AND dts.team = ANY(${EXPECTED_TIME_TEAMS}::text[])) AS no_time_log,
              (SELECT COALESCE(SUM(hours), 0) FROM time_entries
               WHERE spent_on = CURRENT_DATE - 1
               AND project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))) AS yesterday_hours,
              (SELECT COALESCE(SUM(hours), 0) FROM time_entries
               WHERE spent_on = CURRENT_DATE
               AND project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))) AS today_hours
          `,

      // Projects with deadline + progress
      isTeamLead
        ? sql`
            SELECT DISTINCT p.name, p.deadline, p.progress_pct, p.risk, p.status
            FROM projects p
            JOIN issues i ON i.project_id = p.id
            JOIN users u ON u.id = i.assigned_to_id
            WHERE p.status = 'active' AND u.team = ${team}
            ORDER BY p.deadline ASC NULLS LAST
          `
        : sql`
            SELECT name, deadline, progress_pct, risk, status
            FROM projects
            WHERE status = 'active'
            ORDER BY deadline ASC NULLS LAST
          `,

      // Workload by team
      isTeamLead
        ? sql`
            SELECT
              u.team,
              COUNT(DISTINCT u.id) AS member_count,
              (SELECT COUNT(*) FROM issues i2
               JOIN users u2 ON u2.id = i2.assigned_to_id
               WHERE u2.team = u.team AND i2.status NOT IN ('Closed','Resolved','Verified','Rejected')
               AND i2.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))) AS open_tickets,
              ROUND(AVG(
                (SELECT COUNT(*) FROM issues i3
                 WHERE i3.assigned_to_id = u.id AND i3.status NOT IN ('Closed','Resolved','Verified','Rejected')
                 AND i3.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[])))
              )) AS avg_tickets_per_person
            FROM users u
            WHERE u.active = true AND u.team = ${team}
            GROUP BY u.team
            ORDER BY u.team
          `
        : sql`
            SELECT
              u.team,
              COUNT(DISTINCT u.id) AS member_count,
              (SELECT COUNT(*) FROM issues i2
               JOIN users u2 ON u2.id = i2.assigned_to_id
               WHERE u2.team = u.team AND i2.status NOT IN ('Closed','Resolved','Verified','Rejected')
               AND i2.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))) AS open_tickets,
              ROUND(AVG(
                (SELECT COUNT(*) FROM issues i3
                 WHERE i3.assigned_to_id = u.id AND i3.status NOT IN ('Closed','Resolved','Verified','Rejected')
                 AND i3.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[])))
              )) AS avg_tickets_per_person
            FROM users u
            WHERE u.active = true AND u.team IS NOT NULL
            GROUP BY u.team
            ORDER BY u.team
          `,

      // Alert items — overdue tickets
      isTeamLead
        ? sql`
            SELECT i.id, i.title, u.name AS assigned_to, i.due_date
            FROM issues i
            LEFT JOIN users u ON u.id = i.assigned_to_id
            WHERE i.due_date IS NOT NULL
            AND i.due_date < CURRENT_DATE
            AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
            AND u.team = ${team}
            ORDER BY i.due_date ASC
            LIMIT 5
          `
        : sql`
            SELECT i.id, i.title, u.name AS assigned_to, i.due_date
            FROM issues i
            LEFT JOIN users u ON u.id = i.assigned_to_id
            WHERE i.due_date IS NOT NULL
            AND i.due_date < CURRENT_DATE
            AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
            AND i.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))
            ORDER BY i.due_date ASC
            LIMIT 5
          `,
    ]);

    // Per-member hours today for workload drilldown
    const memberHours = isTeamLead
      ? await sql`
          SELECT u.id, u.name, u.team,
            COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE), 0) AS hours_today,
            (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.status NOT IN ('Closed','Resolved','Verified','Rejected') AND i.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))) AS open_tickets
          FROM users u
          WHERE u.active = true AND u.team = ${team}
          ORDER BY u.team, u.name
        `
      : await sql`
          SELECT u.id, u.name, u.team,
            COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE), 0) AS hours_today,
            (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.status NOT IN ('Closed','Resolved','Verified','Rejected') AND i.project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[]))) AS open_tickets
          FROM users u
          WHERE u.active = true AND u.team IS NOT NULL
          ORDER BY u.team, u.name
        `;

    res.status(200).json({
      kpis: kpis[0] || {},
      projects,
      workload,
      alerts,
      memberHours,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
