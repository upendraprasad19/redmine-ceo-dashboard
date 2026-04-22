/**
 * lib/gpt-executor.js
 * Shared tool executor used by both Telegram bot and Dashboard Intelligence tab.
 * Takes a tool call from the AI response, executes against the Neon DB, returns result string.
 */

const { getDb } = require('./db');

// Status mapping — normalize common aliases to actual DB values
const STATUS_MAP = {
  open: ['New', 'Open'],
  in_progress: ['In Progress'],
  blocked: ['Blocked'],
  review: ['Review', 'In Review', 'Feedback'],
  closed: ['Closed', 'Resolved'],
};

/**
 * Execute a tool call and return a JSON string result.
 * @param {string} toolName - The function name from the AI tool_call
 * @param {object} args - Parsed arguments from the AI tool_call
 * @param {object} currentUser - { id, role, team, display_name }
 * @returns {string} JSON-stringified result
 */
async function executeToolCall(toolName, args, currentUser) {
  const sql = getDb();
  const isManager = currentUser.role === 'manager';
  const teamFilter = !isManager ? currentUser.team : null;

  try {
    switch (toolName) {
      // ─────────────────────────────────────────────────
      // GET TICKETS
      // ─────────────────────────────────────────────────
      case 'get_tickets': {
        const { status, priority, assignee_name, project_name, due_within_days,
                created_today, created_since, keyword, my_tickets, unassigned, reporter_name } = args || {};

        // Resolve created_since to a date
        let createdSinceDate = null;
        if (created_since) {
          if (created_since === 'this_week') createdSinceDate = "date_trunc('week', CURRENT_DATE)";
          else if (created_since === 'this_month') createdSinceDate = "date_trunc('month', CURRENT_DATE)";
          else if (created_since === 'this_quarter') createdSinceDate = "date_trunc('quarter', CURRENT_DATE)";
          else createdSinceDate = `'${created_since}'`; // ISO date string
        }

        // Resolve my_tickets — find the linked redmine user ID
        let myUserId = null;
        if (my_tickets) {
          if (currentUser.linked_redmine_user_id) {
            myUserId = currentUser.linked_redmine_user_id;
          } else {
            // Fallback: match by display_name
            const userMatch = await sql`
              SELECT id FROM users WHERE name ILIKE ${'%' + (currentUser.display_name || '') + '%'} AND active = true LIMIT 1
            `;
            myUserId = userMatch[0]?.id || null;
          }
        }

        // Build conditions array for dynamic filtering
        // Using neon tagged template, we construct the full query with all possible filters
        let rows;

        if (status === 'overdue') {
          // Special case: overdue tickets
          rows = teamFilter
            ? await sql`
                SELECT
                  i.id, i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
                  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team
                FROM issues i
                LEFT JOIN users u ON u.id = i.assigned_to_id
                LEFT JOIN projects p ON p.id = i.project_id
                LEFT JOIN users reporter ON reporter.id = i.author_id
                WHERE i.due_date IS NOT NULL
                  AND i.due_date < CURRENT_DATE
                  AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
                  AND (${!assignee_name} OR u.name ILIKE ${'%' + (assignee_name || '') + '%'})
                  AND (${!project_name} OR p.name ILIKE ${'%' + (project_name || '') + '%'})
                  AND (${!priority} OR i.priority ILIKE ${'%' + (priority || '') + '%'})
                  AND (${!keyword} OR i.title ILIKE ${'%' + (keyword || '') + '%'} OR i.description ILIKE ${'%' + (keyword || '') + '%'})
                  AND (${!created_today} OR DATE(i.created_on) = CURRENT_DATE)
                  AND (${!unassigned} OR i.assigned_to_id IS NULL)
                  AND (${!myUserId} OR i.assigned_to_id = ${myUserId || 0})
                  AND (${!reporter_name} OR reporter.name ILIKE ${'%' + (reporter_name || '') + '%'})
                  AND u.team = ${teamFilter}
                ORDER BY i.due_date ASC
                LIMIT 50
              `
            : await sql`
                SELECT
                  i.id, i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
                  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team
                FROM issues i
                LEFT JOIN users u ON u.id = i.assigned_to_id
                LEFT JOIN projects p ON p.id = i.project_id
                LEFT JOIN users reporter ON reporter.id = i.author_id
                WHERE i.due_date IS NOT NULL
                  AND i.due_date < CURRENT_DATE
                  AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
                  AND (${!assignee_name} OR u.name ILIKE ${'%' + (assignee_name || '') + '%'})
                  AND (${!project_name} OR p.name ILIKE ${'%' + (project_name || '') + '%'})
                  AND (${!priority} OR i.priority ILIKE ${'%' + (priority || '') + '%'})
                  AND (${!keyword} OR i.title ILIKE ${'%' + (keyword || '') + '%'} OR i.description ILIKE ${'%' + (keyword || '') + '%'})
                  AND (${!created_today} OR DATE(i.created_on) = CURRENT_DATE)
                  AND (${!unassigned} OR i.assigned_to_id IS NULL)
                  AND (${!myUserId} OR i.assigned_to_id = ${myUserId || 0})
                  AND (${!reporter_name} OR reporter.name ILIKE ${'%' + (reporter_name || '') + '%'})
                ORDER BY i.due_date ASC
                LIMIT 50
              `;
        } else if (status === 'closed') {
          rows = teamFilter
            ? await sql`
                SELECT
                  i.id, i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
                  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team
                FROM issues i
                LEFT JOIN users u ON u.id = i.assigned_to_id
                LEFT JOIN projects p ON p.id = i.project_id
                LEFT JOIN users reporter ON reporter.id = i.author_id
                WHERE i.status IN ('Closed', 'Resolved')
                  AND (${!assignee_name} OR u.name ILIKE ${'%' + (assignee_name || '') + '%'})
                  AND (${!project_name} OR p.name ILIKE ${'%' + (project_name || '') + '%'})
                  AND (${!priority} OR i.priority ILIKE ${'%' + (priority || '') + '%'})
                  AND (${!keyword} OR i.title ILIKE ${'%' + (keyword || '') + '%'})
                  AND (${!created_today} OR DATE(i.created_on) = CURRENT_DATE)
                  AND (${!reporter_name} OR reporter.name ILIKE ${'%' + (reporter_name || '') + '%'})
                  AND u.team = ${teamFilter}
                ORDER BY i.due_date DESC NULLS LAST
                LIMIT 50
              `
            : await sql`
                SELECT
                  i.id, i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
                  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team
                FROM issues i
                LEFT JOIN users u ON u.id = i.assigned_to_id
                LEFT JOIN projects p ON p.id = i.project_id
                LEFT JOIN users reporter ON reporter.id = i.author_id
                WHERE i.status IN ('Closed', 'Resolved')
                  AND (${!assignee_name} OR u.name ILIKE ${'%' + (assignee_name || '') + '%'})
                  AND (${!project_name} OR p.name ILIKE ${'%' + (project_name || '') + '%'})
                  AND (${!priority} OR i.priority ILIKE ${'%' + (priority || '') + '%'})
                  AND (${!keyword} OR i.title ILIKE ${'%' + (keyword || '') + '%'})
                  AND (${!created_today} OR DATE(i.created_on) = CURRENT_DATE)
                  AND (${!reporter_name} OR reporter.name ILIKE ${'%' + (reporter_name || '') + '%'})
                ORDER BY i.due_date DESC NULLS LAST
                LIMIT 50
              `;
        } else {
          // General ticket query (open, in_progress, blocked, review, all)
          const statusValues = status && status !== 'all' ? (STATUS_MAP[status] || [status]) : null;
          const excludeClosed = !status || status === 'all' ? false : true;

          rows = teamFilter
            ? await sql`
                SELECT
                  i.id, i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
                  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team,
                  (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')) AS overdue
                FROM issues i
                LEFT JOIN users u ON u.id = i.assigned_to_id
                LEFT JOIN projects p ON p.id = i.project_id
                LEFT JOIN users reporter ON reporter.id = i.author_id
                WHERE u.team = ${teamFilter}
                  AND (${!statusValues} OR i.status = ANY(${statusValues}))
                  AND (${!excludeClosed || !!statusValues} OR i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected'))
                  AND (${!assignee_name} OR u.name ILIKE ${'%' + (assignee_name || '') + '%'})
                  AND (${!project_name} OR p.name ILIKE ${'%' + (project_name || '') + '%'})
                  AND (${!priority} OR i.priority ILIKE ${'%' + (priority || '') + '%'})
                  AND (${!due_within_days} OR (i.due_date IS NOT NULL AND i.due_date <= CURRENT_DATE + ${due_within_days || 0}))
                  AND (${!keyword} OR i.title ILIKE ${'%' + (keyword || '') + '%'} OR i.description ILIKE ${'%' + (keyword || '') + '%'})
                  AND (${!created_today} OR DATE(i.created_on) = CURRENT_DATE)
                  AND (${!unassigned} OR i.assigned_to_id IS NULL)
                  AND (${!myUserId} OR i.assigned_to_id = ${myUserId || 0})
                  AND (${!reporter_name} OR reporter.name ILIKE ${'%' + (reporter_name || '') + '%'})
                ORDER BY i.due_date ASC NULLS LAST
                LIMIT 50
              `
            : await sql`
                SELECT
                  i.id, i.redmine_id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority,
                  i.due_date, i.created_on, p.name AS project_name, u.name AS assigned_to, u.team,
                  (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')) AS overdue
                FROM issues i
                LEFT JOIN users u ON u.id = i.assigned_to_id
                LEFT JOIN projects p ON p.id = i.project_id
                LEFT JOIN users reporter ON reporter.id = i.author_id
                WHERE (${!statusValues} OR i.status = ANY(${statusValues}))
                  AND (${!excludeClosed || !!statusValues} OR i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected'))
                  AND (${!assignee_name} OR u.name ILIKE ${'%' + (assignee_name || '') + '%'})
                  AND (${!project_name} OR p.name ILIKE ${'%' + (project_name || '') + '%'})
                  AND (${!priority} OR i.priority ILIKE ${'%' + (priority || '') + '%'})
                  AND (${!due_within_days} OR (i.due_date IS NOT NULL AND i.due_date <= CURRENT_DATE + ${due_within_days || 0}))
                  AND (${!keyword} OR i.title ILIKE ${'%' + (keyword || '') + '%'} OR i.description ILIKE ${'%' + (keyword || '') + '%'})
                  AND (${!created_today} OR DATE(i.created_on) = CURRENT_DATE)
                  AND (${!unassigned} OR i.assigned_to_id IS NULL)
                  AND (${!myUserId} OR i.assigned_to_id = ${myUserId || 0})
                  AND (${!reporter_name} OR reporter.name ILIKE ${'%' + (reporter_name || '') + '%'})
                ORDER BY i.due_date ASC NULLS LAST
                LIMIT 50
              `;
        }

        // Add Redmine hyperlink to each ticket
        const REDMINE_URL = 'https://redmine.thinkingcode.com';
        const ticketsWithLinks = (rows || []).map(t => ({
          ...t,
          ticket_link: t.redmine_id ? `[TK-${t.redmine_id}](${REDMINE_URL}/issues/${t.redmine_id})` : t.ticket_id,
        }));

        return JSON.stringify({
          tickets: ticketsWithLinks,
          count: ticketsWithLinks.length,
          filters_applied: { status, priority, assignee_name, project_name, due_within_days, created_today, keyword, my_tickets, unassigned, reporter_name },
          note: 'Use ticket_link field for clickable Telegram hyperlinks.',
        });
      }

      // ─────────────────────────────────────────────────
      // GET TIME LOGS
      // ─────────────────────────────────────────────────
      case 'get_time_logs': {
        const { range = 'daily', missing_only, team, person_name } = args || {};

        // Determine the effective team filter
        const effectiveTeam = teamFilter || team || null;

        const logs = effectiveTeam
          ? await sql`
              SELECT
                u.id, u.name, u.team, u.initials,
                COALESCE(SUM(te.hours), 0) AS hours,
                COALESCE(SUM(te.hours), 0) > 0 AS logged,
                COUNT(DISTINCT te.spent_on) AS days_logged
              FROM users u
              LEFT JOIN time_entries te ON te.user_id = u.id AND (
                (${range} = 'daily' AND te.spent_on = CURRENT_DATE) OR
                (${range} = 'weekly' AND te.spent_on >= date_trunc('week', CURRENT_DATE)) OR
                (${range} = 'monthly' AND te.spent_on >= date_trunc('month', CURRENT_DATE)) OR
                (${range} = 'quarterly' AND te.spent_on >= date_trunc('quarter', CURRENT_DATE)) OR
                (${range} = 'yearly' AND te.spent_on >= date_trunc('year', CURRENT_DATE))
              )
              WHERE u.active = true
                AND u.team = ${effectiveTeam}
                AND (${!person_name} OR u.name ILIKE ${'%' + (person_name || '') + '%'})
              GROUP BY u.id, u.name, u.team, u.initials
              ORDER BY u.name
            `
          : await sql`
              SELECT
                u.id, u.name, u.team, u.initials,
                COALESCE(SUM(te.hours), 0) AS hours,
                COALESCE(SUM(te.hours), 0) > 0 AS logged,
                COUNT(DISTINCT te.spent_on) AS days_logged
              FROM users u
              LEFT JOIN time_entries te ON te.user_id = u.id AND (
                (${range} = 'daily' AND te.spent_on = CURRENT_DATE) OR
                (${range} = 'weekly' AND te.spent_on >= date_trunc('week', CURRENT_DATE)) OR
                (${range} = 'monthly' AND te.spent_on >= date_trunc('month', CURRENT_DATE)) OR
                (${range} = 'quarterly' AND te.spent_on >= date_trunc('quarter', CURRENT_DATE)) OR
                (${range} = 'yearly' AND te.spent_on >= date_trunc('year', CURRENT_DATE))
              )
              WHERE u.active = true
                AND (${!person_name} OR u.name ILIKE ${'%' + (person_name || '') + '%'})
              GROUP BY u.id, u.name, u.team, u.initials
              ORDER BY u.team, u.name
            `;

        const filtered = missing_only ? logs.filter(l => !l.logged) : logs;
        const totalHours = logs.reduce((s, l) => s + parseFloat(l.hours || 0), 0);
        const loggedCount = logs.filter(l => l.logged).length;
        const missingNames = logs.filter(l => !l.logged).map(l => l.name);

        return JSON.stringify({
          logs: filtered,
          count: filtered.length,
          summary: {
            range,
            total_hours: Math.round(totalHours * 10) / 10,
            logged_count: loggedCount,
            missing_count: missingNames.length,
            missing_names: missingNames,
          },
        });
      }

      // ─────────────────────────────────────────────────
      // GET PERSON SUMMARY
      // ─────────────────────────────────────────────────
      case 'get_person_summary': {
        const { person_name } = args || {};
        if (!person_name) return JSON.stringify({ error: 'person_name is required' });

        // Find user by fuzzy name match
        const users = teamFilter
          ? await sql`
              SELECT id, name, team, role, initials
              FROM users
              WHERE name ILIKE ${'%' + person_name + '%'}
                AND active = true
                AND team = ${teamFilter}
              LIMIT 5
            `
          : await sql`
              SELECT id, name, team, role, initials
              FROM users
              WHERE name ILIKE ${'%' + person_name + '%'}
                AND active = true
              LIMIT 5
            `;

        if (users.length === 0) {
          return JSON.stringify({ error: `No person found matching "${person_name}"${teamFilter ? ' in your team' : ''}` });
        }

        const person = users[0];

        // Fetch all data in parallel
        const [tickets, hourData, leaveData, perfData, capacityData] = await Promise.all([
          // Open tickets
          sql`
            SELECT i.id, 'TK-' || i.redmine_id AS ticket_id, i.title, i.status, i.priority, i.due_date,
                   p.name AS project_name,
                   (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')) AS overdue
            FROM issues i
            LEFT JOIN projects p ON p.id = i.project_id
            WHERE i.assigned_to_id = ${person.id}
              AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
            ORDER BY i.due_date ASC NULLS LAST
            LIMIT 20
          `,
          // Hours this week and month
          sql`
            SELECT
              COALESCE(SUM(CASE WHEN te.spent_on >= date_trunc('week', CURRENT_DATE) THEN te.hours ELSE 0 END), 0) AS hours_this_week,
              COALESCE(SUM(CASE WHEN te.spent_on >= date_trunc('month', CURRENT_DATE) THEN te.hours ELSE 0 END), 0) AS hours_this_month,
              COALESCE(SUM(CASE WHEN te.spent_on = CURRENT_DATE THEN te.hours ELSE 0 END), 0) AS hours_today
            FROM time_entries te
            WHERE te.user_id = ${person.id}
          `,
          // Current leave
          sql`
            SELECT leave_type, start_date, end_date
            FROM leave_records
            WHERE user_id = ${person.id}
              AND end_date >= CURRENT_DATE
            ORDER BY start_date ASC
            LIMIT 3
          `,
          // Latest performance snapshot
          sql`
            SELECT overall_score, trend, snapshot_date
            FROM performance_snapshots
            WHERE user_id = ${person.id}
            ORDER BY snapshot_date DESC
            LIMIT 1
          `,
          // Current capacity
          sql`
            SELECT current_workload_pct, active_tickets, available_capacity_pct
            FROM capacity_status
            WHERE user_id = ${person.id}
            LIMIT 1
          `,
        ]);

        const hours = hourData[0] || { hours_today: 0, hours_this_week: 0, hours_this_month: 0 };
        const overdueCount = tickets.filter(t => t.overdue).length;
        const blockedCount = tickets.filter(t => t.status === 'Blocked').length;

        return JSON.stringify({
          person: { name: person.name, team: person.team, role: person.role },
          tickets: {
            open: tickets.length,
            overdue: overdueCount,
            blocked: blockedCount,
            list: tickets.slice(0, 10),
          },
          hours: {
            today: parseFloat(hours.hours_today) || 0,
            this_week: parseFloat(hours.hours_this_week) || 0,
            this_month: parseFloat(hours.hours_this_month) || 0,
          },
          leave: leaveData.length > 0 ? leaveData : null,
          performance: perfData[0] || null,
          capacity: capacityData[0] || null,
          multiple_matches: users.length > 1 ? users.map(u => u.name) : undefined,
        });
      }

      // ─────────────────────────────────────────────────
      // GET PROJECT STATUS
      // ─────────────────────────────────────────────────
      case 'get_project_status': {
        const { project_name } = args || {};

        let projects;
        if (project_name) {
          projects = teamFilter
            ? await sql`
                SELECT p.id, p.name, p.status, p.deadline, p.progress_pct, p.risk,
                       m.name AS manager_name
                FROM projects p
                LEFT JOIN users m ON m.id = p.manager_id
                WHERE p.name ILIKE ${'%' + project_name + '%'}
                  AND EXISTS (SELECT 1 FROM issues i JOIN users u ON u.id = i.assigned_to_id WHERE i.project_id = p.id AND u.team = ${teamFilter})
                ORDER BY p.name LIMIT 10
              `
            : await sql`
                SELECT p.id, p.name, p.status, p.deadline, p.progress_pct, p.risk,
                       m.name AS manager_name
                FROM projects p
                LEFT JOIN users m ON m.id = p.manager_id
                WHERE p.name ILIKE ${'%' + project_name + '%'}
                ORDER BY p.name LIMIT 10
              `;
        } else {
          projects = teamFilter
            ? await sql`
                SELECT p.id, p.name, p.status, p.deadline, p.progress_pct, p.risk,
                       m.name AS manager_name
                FROM projects p
                LEFT JOIN users m ON m.id = p.manager_id
                WHERE p.status = 'active'
                  AND EXISTS (SELECT 1 FROM issues i JOIN users u ON u.id = i.assigned_to_id WHERE i.project_id = p.id AND u.team = ${teamFilter})
                ORDER BY p.deadline ASC NULLS LAST
              `
            : await sql`
                SELECT p.id, p.name, p.status, p.deadline, p.progress_pct, p.risk,
                       m.name AS manager_name
                FROM projects p
                LEFT JOIN users m ON m.id = p.manager_id
                WHERE p.status = 'active'
                ORDER BY p.deadline ASC NULLS LAST
              `;
        }

        if (projects.length === 0) {
          return JSON.stringify({ error: project_name ? `No project found matching "${project_name}"` : 'No active projects found' });
        }

        // For each project, get ticket stats
        const enriched = await Promise.all(projects.map(async (proj) => {
          const stats = await sql`
            SELECT
              COUNT(*) FILTER (WHERE status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')) AS open_tickets,
              COUNT(*) FILTER (WHERE status IN ('Blocked')) AS blocked_tickets,
              COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')) AS overdue_tickets,
              COUNT(*) FILTER (WHERE status IN ('Closed', 'Resolved')) AS closed_tickets,
              COUNT(*) AS total_tickets
            FROM issues
            WHERE project_id = ${proj.id}
          `;

          return {
            ...proj,
            ticket_stats: stats[0] || {},
          };
        }));

        return JSON.stringify({
          projects: enriched,
          count: enriched.length,
        });
      }

      // ─────────────────────────────────────────────────
      // GET TEAM LEAVE
      // ─────────────────────────────────────────────────
      case 'get_team_leave': {
        const { period = 'today', team } = args || {};
        const effectiveTeam = teamFilter || team || null;

        let rows;
        if (period === 'today') {
          rows = effectiveTeam
            ? await sql`
                SELECT u.name, u.team, lr.leave_type, lr.start_date, lr.end_date
                FROM leave_records lr
                JOIN users u ON u.id = lr.user_id
                WHERE CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
                  AND u.team = ${effectiveTeam}
                ORDER BY u.team, u.name
              `
            : await sql`
                SELECT u.name, u.team, lr.leave_type, lr.start_date, lr.end_date
                FROM leave_records lr
                JOIN users u ON u.id = lr.user_id
                WHERE CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
                ORDER BY u.team, u.name
              `;
        } else if (period === 'this_week') {
          rows = effectiveTeam
            ? await sql`
                SELECT u.name, u.team, lr.leave_type, lr.start_date, lr.end_date
                FROM leave_records lr
                JOIN users u ON u.id = lr.user_id
                WHERE lr.start_date <= (date_trunc('week', CURRENT_DATE) + interval '6 days')
                  AND lr.end_date >= date_trunc('week', CURRENT_DATE)
                  AND u.team = ${effectiveTeam}
                ORDER BY lr.start_date, u.name
              `
            : await sql`
                SELECT u.name, u.team, lr.leave_type, lr.start_date, lr.end_date
                FROM leave_records lr
                JOIN users u ON u.id = lr.user_id
                WHERE lr.start_date <= (date_trunc('week', CURRENT_DATE) + interval '6 days')
                  AND lr.end_date >= date_trunc('week', CURRENT_DATE)
                ORDER BY lr.start_date, u.team, u.name
              `;
        } else {
          // upcoming = next 14 days
          rows = effectiveTeam
            ? await sql`
                SELECT u.name, u.team, lr.leave_type, lr.start_date, lr.end_date
                FROM leave_records lr
                JOIN users u ON u.id = lr.user_id
                WHERE lr.start_date <= CURRENT_DATE + 14
                  AND lr.end_date >= CURRENT_DATE
                  AND u.team = ${effectiveTeam}
                ORDER BY lr.start_date, u.name
              `
            : await sql`
                SELECT u.name, u.team, lr.leave_type, lr.start_date, lr.end_date
                FROM leave_records lr
                JOIN users u ON u.id = lr.user_id
                WHERE lr.start_date <= CURRENT_DATE + 14
                  AND lr.end_date >= CURRENT_DATE
                ORDER BY lr.start_date, u.team, u.name
              `;
        }

        return JSON.stringify({
          period,
          on_leave: rows,
          count: rows.length,
        });
      }

      // ─────────────────────────────────────────────────
      // GET CAPACITY STATUS
      // ─────────────────────────────────────────────────
      case 'get_capacity_status': {
        const { team, available_only } = args || {};
        const effectiveTeam = teamFilter || team || null;

        let rows;
        if (effectiveTeam && available_only) {
          rows = await sql`
            SELECT u.name, u.team, cs.current_workload_pct, cs.active_tickets, cs.available_capacity_pct
            FROM capacity_status cs
            JOIN users u ON u.id = cs.user_id
            WHERE u.team = ${effectiveTeam}
              AND cs.available_capacity_pct > 30
            ORDER BY cs.available_capacity_pct DESC
          `;
        } else if (effectiveTeam) {
          rows = await sql`
            SELECT u.name, u.team, cs.current_workload_pct, cs.active_tickets, cs.available_capacity_pct
            FROM capacity_status cs
            JOIN users u ON u.id = cs.user_id
            WHERE u.team = ${effectiveTeam}
            ORDER BY cs.current_workload_pct DESC
          `;
        } else if (available_only) {
          rows = await sql`
            SELECT u.name, u.team, cs.current_workload_pct, cs.active_tickets, cs.available_capacity_pct
            FROM capacity_status cs
            JOIN users u ON u.id = cs.user_id
            WHERE cs.available_capacity_pct > 30
            ORDER BY cs.available_capacity_pct DESC
          `;
        } else {
          rows = await sql`
            SELECT u.name, u.team, cs.current_workload_pct, cs.active_tickets, cs.available_capacity_pct
            FROM capacity_status cs
            JOIN users u ON u.id = cs.user_id
            ORDER BY u.team, cs.current_workload_pct DESC
          `;
        }

        // Compute team-level summaries
        const teamSummary = {};
        for (const r of rows) {
          if (!teamSummary[r.team]) {
            teamSummary[r.team] = { members: 0, total_workload: 0, total_tickets: 0 };
          }
          teamSummary[r.team].members++;
          teamSummary[r.team].total_workload += parseFloat(r.current_workload_pct || 0);
          teamSummary[r.team].total_tickets += parseInt(r.active_tickets || 0);
        }
        for (const t of Object.keys(teamSummary)) {
          teamSummary[t].avg_workload = Math.round(teamSummary[t].total_workload / teamSummary[t].members);
        }

        return JSON.stringify({
          members: rows,
          count: rows.length,
          team_summary: teamSummary,
        });
      }

      // ─────────────────────────────────────────────────
      // GET PERFORMANCE REPORT
      // ─────────────────────────────────────────────────
      case 'get_performance_report': {
        const { person_name, team, period = 'latest' } = args || {};
        const effectiveTeam = teamFilter || team || null;

        let rows;
        if (person_name) {
          // Specific person
          const dateFilter = period === 'monthly'
            ? "AND ps.snapshot_date >= date_trunc('month', CURRENT_DATE)"
            : period === 'quarterly'
              ? "AND ps.snapshot_date >= date_trunc('quarter', CURRENT_DATE)"
              : '';

          rows = period === 'latest'
            ? await sql`
                SELECT u.name, u.team, ps.overall_score, ps.trend, ps.snapshot_date
                FROM performance_snapshots ps
                JOIN users u ON u.id = ps.user_id
                WHERE u.name ILIKE ${'%' + person_name + '%'}
                  AND u.active = true
                  AND (${!effectiveTeam} OR u.team = ${effectiveTeam})
                ORDER BY ps.snapshot_date DESC
                LIMIT 1
              `
            : period === 'monthly'
              ? await sql`
                  SELECT u.name, u.team, ps.overall_score, ps.trend, ps.snapshot_date
                  FROM performance_snapshots ps
                  JOIN users u ON u.id = ps.user_id
                  WHERE u.name ILIKE ${'%' + person_name + '%'}
                    AND u.active = true
                    AND (${!effectiveTeam} OR u.team = ${effectiveTeam})
                    AND ps.snapshot_date >= date_trunc('month', CURRENT_DATE)
                  ORDER BY ps.snapshot_date DESC
                `
              : await sql`
                  SELECT u.name, u.team, ps.overall_score, ps.trend, ps.snapshot_date
                  FROM performance_snapshots ps
                  JOIN users u ON u.id = ps.user_id
                  WHERE u.name ILIKE ${'%' + person_name + '%'}
                    AND u.active = true
                    AND (${!effectiveTeam} OR u.team = ${effectiveTeam})
                    AND ps.snapshot_date >= date_trunc('quarter', CURRENT_DATE)
                  ORDER BY ps.snapshot_date DESC
                `;
        } else {
          // Team or all
          rows = effectiveTeam
            ? await sql`
                SELECT DISTINCT ON (u.id) u.name, u.team, ps.overall_score, ps.trend, ps.snapshot_date
                FROM performance_snapshots ps
                JOIN users u ON u.id = ps.user_id
                WHERE u.active = true AND u.team = ${effectiveTeam}
                ORDER BY u.id, ps.snapshot_date DESC
              `
            : await sql`
                SELECT DISTINCT ON (u.id) u.name, u.team, ps.overall_score, ps.trend, ps.snapshot_date
                FROM performance_snapshots ps
                JOIN users u ON u.id = ps.user_id
                WHERE u.active = true
                ORDER BY u.id, ps.snapshot_date DESC
              `;
        }

        if (rows.length === 0) {
          return JSON.stringify({ error: 'No performance data found for the given criteria' });
        }

        // Compute averages by team
        const teamAvgs = {};
        for (const r of rows) {
          if (!teamAvgs[r.team]) { teamAvgs[r.team] = { total: 0, count: 0 }; }
          teamAvgs[r.team].total += parseFloat(r.overall_score || 0);
          teamAvgs[r.team].count++;
        }
        for (const t of Object.keys(teamAvgs)) {
          teamAvgs[t].average = Math.round((teamAvgs[t].total / teamAvgs[t].count) * 10) / 10;
        }

        return JSON.stringify({
          snapshots: rows,
          count: rows.length,
          team_averages: teamAvgs,
        });
      }

      // ─────────────────────────────────────────────────
      // GET TEAM HEALTH
      // ─────────────────────────────────────────────────
      case 'get_team_health': {
        const { team } = args || {};
        const effectiveTeam = teamFilter || team || null;

        const rows = effectiveTeam
          ? await sql`
              SELECT team, week_start, overall_score, trend
              FROM team_health
              WHERE team = ${effectiveTeam}
              ORDER BY week_start DESC
              LIMIT 4
            `
          : await sql`
              SELECT DISTINCT ON (team) team, week_start, overall_score, trend
              FROM team_health
              ORDER BY team, week_start DESC
            `;

        return JSON.stringify({
          health: rows,
          count: rows.length,
        });
      }

      // ─────────────────────────────────────────────────
      // SEARCH KNOWLEDGE
      // ─────────────────────────────────────────────────
      case 'search_knowledge': {
        // Vector search requires embeddings — placeholder for future implementation
        // When ready: embed(query) -> search conversation_memory using cosine similarity
        return JSON.stringify({
          results: [],
          note: 'Knowledge base search coming soon. Vector embedding pipeline is being set up.',
        });
      }

      // ─────────────────────────────────────────────────
      // CREATE EXPLORATION
      // ─────────────────────────────────────────────────
      case 'create_exploration': {
        const { name, description, vision } = args || {};
        if (!name || !description) {
          return JSON.stringify({ error: 'name and description are required' });
        }

        // Table already exists via migration 006 (UUID PK, status check constraint)
        const result = await sql`
          INSERT INTO project_explorations (name, description, vision, created_by, status)
          VALUES (${name}, ${description}, ${vision || null}, ${currentUser.id}, 'conceptual')
          RETURNING id, name, description, vision, status, created_at
        `;

        return JSON.stringify({
          exploration: result[0],
          message: `Exploration "${name}" created successfully.`,
        });
      }

      // ─────────────────────────────────────────────────
      // PREPARE ONE-ON-ONE
      // ─────────────────────────────────────────────────
      case 'prepare_one_on_one': {
        const { person_name } = args || {};
        if (!person_name) return JSON.stringify({ error: 'person_name is required' });

        // Find the person
        const people = teamFilter
          ? await sql`
              SELECT id, name, team, role
              FROM users
              WHERE name ILIKE ${'%' + person_name + '%'} AND active = true AND team = ${teamFilter}
              LIMIT 1
            `
          : await sql`
              SELECT id, name, team, role
              FROM users
              WHERE name ILIKE ${'%' + person_name + '%'} AND active = true
              LIMIT 1
            `;

        if (people.length === 0) {
          return JSON.stringify({ error: `No person found matching "${person_name}"` });
        }

        const person = people[0];

        // Gather comprehensive data
        const [tickets, hours, overdue, blockedTickets, recentActivity, perfData, leaveData] = await Promise.all([
          sql`
            SELECT i.title, i.status, i.priority, i.due_date, p.name AS project_name
            FROM issues i
            LEFT JOIN projects p ON p.id = i.project_id
            WHERE i.assigned_to_id = ${person.id}
              AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
            ORDER BY i.due_date ASC NULLS LAST
            LIMIT 10
          `,
          sql`
            SELECT
              COALESCE(SUM(CASE WHEN te.spent_on >= date_trunc('week', CURRENT_DATE) THEN te.hours ELSE 0 END), 0) AS hours_this_week,
              COALESCE(SUM(CASE WHEN te.spent_on >= date_trunc('month', CURRENT_DATE) THEN te.hours ELSE 0 END), 0) AS hours_this_month
            FROM time_entries te
            WHERE te.user_id = ${person.id}
          `,
          sql`
            SELECT COUNT(*) AS count
            FROM issues
            WHERE assigned_to_id = ${person.id}
              AND due_date IS NOT NULL AND due_date < CURRENT_DATE
              AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
          `,
          sql`
            SELECT i.title, i.due_date
            FROM issues i
            WHERE i.assigned_to_id = ${person.id} AND i.status = 'Blocked'
            LIMIT 5
          `,
          sql`
            SELECT i.title, ij.notes, ij.created_at
            FROM issue_journals ij
            JOIN issues i ON i.id = ij.issue_id
            WHERE ij.author_id = ${person.id} AND ij.notes IS NOT NULL
            ORDER BY ij.created_at DESC
            LIMIT 5
          `,
          sql`
            SELECT overall_score, trend, snapshot_date
            FROM performance_snapshots
            WHERE user_id = ${person.id}
            ORDER BY snapshot_date DESC
            LIMIT 1
          `,
          sql`
            SELECT leave_type, start_date, end_date
            FROM leave_records
            WHERE user_id = ${person.id} AND end_date >= CURRENT_DATE
            ORDER BY start_date
            LIMIT 3
          `,
        ]);

        const hoursData = hours[0] || { hours_this_week: 0, hours_this_month: 0 };
        const overdueCount = parseInt(overdue[0]?.count || 0);

        const summary = {
          person: { name: person.name, team: person.team, role: person.role },
          open_tickets: tickets.length,
          overdue_tickets: overdueCount,
          blocked_tickets: blockedTickets.map(t => t.title),
          hours_this_week: parseFloat(hoursData.hours_this_week) || 0,
          hours_this_month: parseFloat(hoursData.hours_this_month) || 0,
          performance: perfData[0] || null,
          upcoming_leave: leaveData,
          recent_tickets: tickets.slice(0, 5).map(t => `${t.title} [${t.status}] ${t.project_name || ''}`),
          recent_activity: recentActivity.map(a => ({ title: a.title, note: (a.notes || '').substring(0, 100), date: a.created_at })),
        };

        return JSON.stringify(summary);
      }

      // ─────────────────────────────────────────────────
      // GET VELOCITY PREDICTION
      // ─────────────────────────────────────────────────
      case 'get_velocity_prediction': {
        const { project_name } = args || {};
        if (!project_name) return JSON.stringify({ error: 'project_name is required' });

        // Find the project (scoped by team for team_leads)
        const projects = teamFilter
          ? await sql`
              SELECT id, name, deadline, progress_pct, status
              FROM projects
              WHERE name ILIKE ${'%' + project_name + '%'}
                AND EXISTS (SELECT 1 FROM issues i JOIN users u ON u.id = i.assigned_to_id WHERE i.project_id = projects.id AND u.team = ${teamFilter})
              LIMIT 1
            `
          : await sql`
              SELECT id, name, deadline, progress_pct, status
              FROM projects
              WHERE name ILIKE ${'%' + project_name + '%'}
              LIMIT 1
            `;

        if (projects.length === 0) {
          return JSON.stringify({ error: `No project found matching "${project_name}"` });
        }

        const project = projects[0];

        // Get ticket velocity: tickets closed in last 4 weeks vs total remaining
        const [closedRecent, openCount, totalCount] = await Promise.all([
          sql`
            SELECT COUNT(*) AS count
            FROM issues
            WHERE project_id = ${project.id}
              AND status IN ('Closed', 'Resolved')
              AND created_at >= CURRENT_DATE - 28
          `,
          sql`
            SELECT COUNT(*) AS count
            FROM issues
            WHERE project_id = ${project.id}
              AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
          `,
          sql`
            SELECT COUNT(*) AS count
            FROM issues
            WHERE project_id = ${project.id}
          `,
        ]);

        const closedLast4Weeks = parseInt(closedRecent[0]?.count || 0);
        const openTickets = parseInt(openCount[0]?.count || 0);
        const total = parseInt(totalCount[0]?.count || 0);
        const weeklyVelocity = closedLast4Weeks / 4;

        // Calculate predicted completion
        let weeksToComplete = weeklyVelocity > 0 ? Math.ceil(openTickets / weeklyVelocity) : null;
        let predictedDate = null;
        let willMissDeadline = null;

        if (weeksToComplete !== null) {
          const now = new Date();
          predictedDate = new Date(now.getTime() + weeksToComplete * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          if (project.deadline) {
            willMissDeadline = new Date(predictedDate) > new Date(project.deadline);
          }
        }

        const completionPct = total > 0 ? Math.round(((total - openTickets) / total) * 100) : 0;

        return JSON.stringify({
          project: project.name,
          deadline: project.deadline,
          progress_pct: project.progress_pct || completionPct,
          tickets: {
            total,
            open: openTickets,
            closed_last_4_weeks: closedLast4Weeks,
          },
          velocity: {
            tickets_per_week: Math.round(weeklyVelocity * 10) / 10,
            weeks_to_complete: weeksToComplete,
            predicted_completion_date: predictedDate,
          },
          risk_assessment: {
            will_miss_deadline: willMissDeadline,
            confidence: weeklyVelocity > 2 ? 'medium' : 'low',
            note: weeklyVelocity === 0
              ? 'No tickets closed in the last 4 weeks — cannot predict velocity.'
              : willMissDeadline
                ? `At current velocity (${Math.round(weeklyVelocity * 10) / 10} tickets/week), project will likely miss the deadline.`
                : willMissDeadline === false
                  ? `At current velocity, project is on track to finish before the deadline.`
                  : 'No deadline set — prediction is based on velocity only.',
          },
        });
      }

      // ─────────────────────────────────────────────────
      // GET TICKET COMMENTS
      // ─────────────────────────────────────────────────
      case 'get_ticket_comments': {
        const { ticket_id } = args || {};
        if (!ticket_id) return JSON.stringify({ error: 'ticket_id required' });

        const ticketNum = String(ticket_id).replace(/[^0-9]/g, '');
        const REDMINE_URL = 'https://redmine.thinkingcode.com';

        const issue = await sql`
          SELECT i.id, i.redmine_id, i.title, i.status, i.priority, u.name AS assigned_to
          FROM issues i
          LEFT JOIN users u ON u.id = i.assigned_to_id
          WHERE i.redmine_id = ${ticketNum}
          LIMIT 1
        `;

        if (issue.length === 0) return JSON.stringify({ error: `Ticket ${ticket_id} not found` });

        let comments = [];
        try {
          comments = await sql`
            SELECT j.notes, j.created_on, u.name AS author
            FROM journals j
            LEFT JOIN users u ON u.id = j.user_id
            WHERE j.journalized_id = ${issue[0].id}
              AND j.journalized_type = 'Issue'
              AND j.notes IS NOT NULL AND j.notes != ''
            ORDER BY j.created_on DESC
            LIMIT 10
          `;
        } catch (e) {
          return JSON.stringify({
            ticket: { ...issue[0], ticket_link: `[TK-${issue[0].redmine_id}](${REDMINE_URL}/issues/${issue[0].redmine_id})` },
            comments: [],
            note: 'Comments not synced yet — view in Redmine directly.',
          });
        }

        return JSON.stringify({
          ticket: {
            ticket_link: `[TK-${issue[0].redmine_id}](${REDMINE_URL}/issues/${issue[0].redmine_id})`,
            title: issue[0].title,
            status: issue[0].status,
            assigned_to: issue[0].assigned_to,
          },
          comments: comments.map(c => ({ author: c.author, date: c.created_on, note: c.notes })),
          total: comments.length,
        });
      }

      // ─────────────────────────────────────────────────
      // GET TREND ANALYSIS
      // ─────────────────────────────────────────────────
      case 'get_trend_analysis': {
        const { metric = 'all', weeks = 4, team } = args || {};
        const effectiveTeam = teamFilter || team || null;
        const results = {};

        if (metric === 'velocity' || metric === 'all') {
          const velocity = await sql`
            SELECT DATE_TRUNC('week', updated_at) AS week_start, COUNT(*) AS closed_count
            FROM issues i
            LEFT JOIN users u ON u.id = i.assigned_to_id
            WHERE i.status IN ('Closed', 'Resolved')
              AND i.updated_at >= NOW() - (${weeks} || ' weeks')::INTERVAL
              AND (${!effectiveTeam} OR u.team = ${effectiveTeam})
            GROUP BY week_start ORDER BY week_start ASC
          `;
          results.velocity = velocity.map(r => ({ week: r.week_start, closed: parseInt(r.closed_count) }));
        }

        if (metric === 'compliance' || metric === 'all') {
          const compliance = await sql`
            SELECT DATE_TRUNC('week', te.spent_on) AS week_start,
              COUNT(DISTINCT te.user_id) AS logged_count,
              (SELECT COUNT(*) FROM users WHERE active = true AND (${!effectiveTeam} OR team = ${effectiveTeam})) AS total_users
            FROM time_entries te
            LEFT JOIN users u ON u.id = te.user_id
            WHERE te.spent_on >= NOW() - (${weeks} || ' weeks')::INTERVAL
              AND (${!effectiveTeam} OR u.team = ${effectiveTeam})
            GROUP BY week_start ORDER BY week_start ASC
          `;
          results.compliance = compliance.map(r => ({
            week: r.week_start,
            logged: parseInt(r.logged_count),
            total: parseInt(r.total_users),
            pct: Math.round((parseInt(r.logged_count) / Math.max(parseInt(r.total_users), 1)) * 100),
          }));
        }

        if (metric === 'creation_vs_closure' || metric === 'all') {
          const creation = await sql`
            SELECT DATE_TRUNC('week', i.created_on) AS week_start, COUNT(*) AS created_count
            FROM issues i
            LEFT JOIN users u ON u.id = i.assigned_to_id
            WHERE i.created_on >= NOW() - (${weeks} || ' weeks')::INTERVAL
              AND (${!effectiveTeam} OR u.team = ${effectiveTeam})
            GROUP BY week_start ORDER BY week_start ASC
          `;
          results.creation_rate = creation.map(r => ({ week: r.week_start, created: parseInt(r.created_count) }));
        }

        return JSON.stringify({ trend_analysis: results, weeks_analyzed: weeks, team: effectiveTeam || 'all' });
      }

      // ─────────────────────────────────────────────────
      // LOG UNKNOWN QUERY
      // ─────────────────────────────────────────────────
      case 'log_unknown_query': {
        const { original_query, reason, suggested_alternative } = args || {};
        try {
          const existing = await sql`
            SELECT id, frequency FROM bot_unknown_queries
            WHERE query_text ILIKE ${'%' + (original_query || '').trim().substring(0, 100) + '%'}
              AND user_role = ${currentUser.role}
            LIMIT 1
          `;
          if (existing.length > 0) {
            await sql`UPDATE bot_unknown_queries SET frequency = frequency + 1, updated_at = NOW() WHERE id = ${existing[0].id}`;
          } else {
            await sql`
              INSERT INTO bot_unknown_queries (user_id, query_text, user_role, user_team, suggested_alternative, frequency)
              VALUES (${currentUser.id}, ${original_query || ''}, ${currentUser.role}, ${currentUser.team || null}, ${suggested_alternative || null}, 1)
            `;
          }
        } catch (e) {
          console.error('Failed to log unknown query:', e.message);
        }
        return JSON.stringify({
          logged: true,
          suggested_alternative,
          response: `I don't have a way to answer that yet — I've noted it for the admin team.\n\n${suggested_alternative ? `Meanwhile: ${suggested_alternative}` : 'Try rephrasing or ask me something else.'}`,
        });
      }

      // ─────────────────────────────────────────────────
      // SET REMINDER
      // ─────────────────────────────────────────────────
      case 'set_reminder': {
        const { message, remind_at } = args || {};
        if (!message || !remind_at) return JSON.stringify({ error: 'message and remind_at are required' });

        let remindDate;
        try {
          const lower = remind_at.toLowerCase();
          if (lower.includes('tomorrow')) {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            const timeMatch = remind_at.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
            if (timeMatch) {
              let h = parseInt(timeMatch[1]);
              const m = parseInt(timeMatch[2] || '0');
              if (timeMatch[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
              if (timeMatch[3]?.toLowerCase() === 'am' && h === 12) h = 0;
              d.setHours(h, m, 0, 0);
            } else { d.setHours(9, 0, 0, 0); }
            remindDate = d;
          } else if (lower.match(/in\s+(\d+)\s+hour/)) {
            const h = parseInt(lower.match(/in\s+(\d+)\s+hour/)[1]);
            remindDate = new Date(Date.now() + h * 3600000);
          } else if (lower.match(/in\s+(\d+)\s+min/)) {
            const m = parseInt(lower.match(/in\s+(\d+)\s+min/)[1]);
            remindDate = new Date(Date.now() + m * 60000);
          } else {
            remindDate = new Date(remind_at);
          }
          if (isNaN(remindDate.getTime())) throw new Error('invalid date');
        } catch (e) {
          return JSON.stringify({ error: 'Could not parse time. Try "tomorrow 10am" or "in 2 hours".' });
        }

        const userRow = await sql`SELECT telegram_id FROM dashboard_users WHERE id = ${currentUser.id} LIMIT 1`;
        const telegramId = String(userRow[0]?.telegram_id || '');
        if (!telegramId) return JSON.stringify({ error: 'No Telegram ID linked to your account' });

        await sql`
          INSERT INTO user_reminders (user_id, telegram_id, message, remind_at)
          VALUES (${currentUser.id}, ${telegramId}, ${message}, ${remindDate.toISOString()})
        `;

        const formatted = remindDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
        return JSON.stringify({ set: true, remind_at: formatted, message: `✅ Reminder set for ${formatted}` });
      }

      // ─────────────────────────────────────────────────
      // PROPOSE INTIMATION
      // ─────────────────────────────────────────────────
      case 'propose_intimation': {
        const { canIntimate } = require('./intimation-relay');
        const { target_user_hint, issue_redmine_id, note } = args || {};
        if (!target_user_hint || !issue_redmine_id) {
          return JSON.stringify({ error: 'target_user_hint and issue_redmine_id are required' });
        }

        // Resolve target: developers only in Phase 1
        const candidates = await sql`
          SELECT id, display_name, username, role, team, telegram_id, consent_given_at
            FROM dashboard_users
           WHERE role = 'developer'
             AND active = true
             AND (display_name ILIKE ${'%' + target_user_hint + '%'}
                  OR username ILIKE ${'%' + target_user_hint + '%'})
           LIMIT 5
        `;
        if (candidates.length === 0) {
          return JSON.stringify({ error: `No developer matches "${target_user_hint}".` });
        }
        if (candidates.length > 1) {
          return JSON.stringify({
            ambiguous: true,
            candidates: candidates.map(c => ({ id: c.id, display_name: c.display_name, team: c.team })),
            hint: 'Ask the user to pick one.',
          });
        }

        const target = candidates[0];
        const perm = canIntimate(
          { role: currentUser.role, team: currentUser.team },
          { role: target.role, team: target.team }
        );
        if (!perm.allowed) return JSON.stringify({ error: perm.reason });

        if (!target.telegram_id) return JSON.stringify({ error: `${target.display_name} hasn't registered Telegram yet.` });
        if (!target.consent_given_at) return JSON.stringify({ error: `${target.display_name} hasn't given consent yet. They need to message the bot and reply /agree first.` });

        const issueRow = await sql`
          SELECT id, redmine_id, title AS subject, status, due_date,
                 GREATEST(0, (CURRENT_DATE - due_date))::int AS days_overdue
            FROM issues WHERE redmine_id = ${issue_redmine_id} LIMIT 1
        `;
        if (issueRow.length === 0) return JSON.stringify({ error: `No ticket TK-${issue_redmine_id} found.` });

        return JSON.stringify({
          confirm_required: true,
          preview: {
            target_user_id: target.id,
            target_display_name: target.display_name,
            issue_id: issueRow[0].id,
            issue_redmine_id: issueRow[0].redmine_id,
            issue_subject: issueRow[0].subject,
            days_overdue: issueRow[0].days_overdue,
            note: note || '',
          },
          next_step: 'The bot must render a preview card with [Yes, send] / [Cancel] buttons whose callback_data is `int:confirm:<target_user_id>:<issue_id>` and `int:cancel`.',
        });
      }

      // ─────────────────────────────────────────────────
      // EXTRACT COMMITMENT
      // ─────────────────────────────────────────────────
      case 'extract_commitment': {
        const { extractCommitment } = require('./commitments');
        const { text } = args || {};
        if (!text) return JSON.stringify({ error: 'text is required' });
        const r = await extractCommitment({ text, now: new Date() });
        return JSON.stringify(r || { has_commitment: false });
      }

      // ─────────────────────────────────────────────────
      // UNKNOWN TOOL
      // ─────────────────────────────────────────────────
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    console.error(`Tool execution error [${toolName}]:`, err);
    return JSON.stringify({
      error: `Failed to execute ${toolName}: ${err.message}`,
    });
  }
}

module.exports = { executeToolCall };
