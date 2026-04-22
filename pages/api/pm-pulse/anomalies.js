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

    const [reopen, stale, workedNotAssigned, assignedNoTime] = await Promise.all([

      // Reopen Watch — issues with status 'Re Open'
      isTeamLead
        ? sql`
            SELECT i.redmine_id, i.title, i.status, i.due_date, i.updated_at,
              p.name AS project_name, u.name AS assigned_to, mu.name AS manager
            FROM issues i
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status = 'Re Open' AND u.team = ${team}
            ORDER BY i.updated_at ASC`
        : sql`
            SELECT i.redmine_id, i.title, i.status, i.due_date, i.updated_at,
              p.name AS project_name, u.name AS assigned_to, mu.name AS manager
            FROM issues i
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status = 'Re Open'
            ORDER BY i.updated_at ASC`,

      // No Update in 3+ Days
      isTeamLead
        ? sql`
            SELECT i.redmine_id, i.title, i.status, i.due_date, i.updated_at,
              p.name AS project_name, u.name AS assigned_to, mu.name AS manager,
              (CURRENT_DATE - i.updated_at::date)::int AS days_since_update
            FROM issues i
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND i.updated_at < NOW() - INTERVAL '3 days'
              AND u.team = ${team}
            ORDER BY i.updated_at ASC`
        : sql`
            SELECT i.redmine_id, i.title, i.status, i.due_date, i.updated_at,
              p.name AS project_name, u.name AS assigned_to, mu.name AS manager,
              (CURRENT_DATE - i.updated_at::date)::int AS days_since_update
            FROM issues i
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND i.updated_at < NOW() - INTERVAL '3 days'
            ORDER BY i.updated_at ASC`,

      // Worked But Not Assigned — logged time but not the assignee
      isTeamLead
        ? sql`
            SELECT i.redmine_id, i.title, i.status,
              p.name AS project_name,
              ua.name AS assigned_to,
              wu.name AS worked_by,
              SUM(te.hours)::float AS hours_logged,
              MAX(te.spent_on) AS last_log_date,
              mu.name AS manager
            FROM time_entries te
            JOIN issues i ON te.issue_id = i.id
            JOIN users wu ON wu.id = te.user_id
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN users ua ON ua.id = i.assigned_to_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND te.user_id IS DISTINCT FROM i.assigned_to_id
              AND wu.team = ${team}
            GROUP BY i.redmine_id, i.title, i.status, p.name, ua.name, wu.name, mu.name
            ORDER BY i.redmine_id`
        : sql`
            SELECT i.redmine_id, i.title, i.status,
              p.name AS project_name,
              ua.name AS assigned_to,
              wu.name AS worked_by,
              SUM(te.hours)::float AS hours_logged,
              MAX(te.spent_on) AS last_log_date,
              mu.name AS manager
            FROM time_entries te
            JOIN issues i ON te.issue_id = i.id
            JOIN users wu ON wu.id = te.user_id
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN users ua ON ua.id = i.assigned_to_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND te.user_id IS DISTINCT FROM i.assigned_to_id
            GROUP BY i.redmine_id, i.title, i.status, p.name, ua.name, wu.name, mu.name
            ORDER BY i.redmine_id`,

      // Assigned But No Time Logged
      isTeamLead
        ? sql`
            SELECT i.redmine_id, i.title, i.status, i.due_date, i.updated_at,
              p.name AS project_name, u.name AS assigned_to, mu.name AS manager
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND i.assigned_to_id IS NOT NULL
              AND u.team = ${team}
              AND NOT EXISTS (
                SELECT 1 FROM time_entries te
                WHERE te.issue_id = i.id AND te.user_id = i.assigned_to_id
              )
            ORDER BY i.due_date ASC NULLS LAST`
        : sql`
            SELECT i.redmine_id, i.title, i.status, i.due_date, i.updated_at,
              p.name AS project_name, u.name AS assigned_to, mu.name AS manager
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            LEFT JOIN projects p ON p.id = i.project_id
            LEFT JOIN LATERAL (SELECT STRING_AGG(uu.name, ', ' ORDER BY uu.name) AS name FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users uu ON uu.id = oid) mu ON true
            WHERE i.status NOT IN ('Closed','Resolved','Verified','Rejected')
              AND i.assigned_to_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM time_entries te
                WHERE te.issue_id = i.id AND te.user_id = i.assigned_to_id
              )
            ORDER BY i.due_date ASC NULLS LAST`,
    ]);

    res.status(200).json({ reopen, stale, workedNotAssigned, assignedNoTime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
