/**
 * intelligence/reports.js
 * Automated report generation: weekly team reports with AI-written summaries.
 */

const { getDb } = require('../lib/db');
const { chat } = require('../lib/ai');

// ────────────────────────────────────────────────────────────────
// buildWeeklyReport — Raw data aggregation for a team over a period
// ────────────────────────────────────────────────────────────────
async function buildWeeklyReport(team, periodDays = 7) {
  const sql = getDb();

  try {
    const since = new Date();
    since.setDate(since.getDate() - periodDays);
    const sinceStr = since.toISOString().slice(0, 10);

    // Get team member IDs
    const members = await sql`
      SELECT id, name FROM users WHERE team = ${team} AND active = true
    `;
    if (!members || members.length === 0) {
      return { team, error: 'No active members', data: null };
    }
    const memberIds = members.map((m) => m.id);
    const memberNames = members.map((m) => m.name);

    // Tickets completed
    const completedRows = await sql`
      SELECT
        COUNT(*)::int AS completed,
        COUNT(*) FILTER (
          WHERE due_date IS NOT NULL AND closed_at <= due_date::timestamptz
        )::int AS on_time
      FROM issues
      WHERE assigned_to_id = ANY(${memberIds})
        AND closed_at >= ${sinceStr}::date
    `;
    const completed = (completedRows && completedRows[0]) || { completed: 0, on_time: 0 };

    // Hours logged
    const hoursRows = await sql`
      SELECT
        COALESCE(SUM(hours), 0)::float AS total_hours,
        COUNT(DISTINCT user_id)::int AS users_logging
      FROM time_entries
      WHERE user_id = ANY(${memberIds})
        AND spent_on >= ${sinceStr}::date
    `;
    const hours = (hoursRows && hoursRows[0]) || { total_hours: 0, users_logging: 0 };

    // Overdue tickets
    const overdueRows = await sql`
      SELECT
        COUNT(*)::int AS overdue_count,
        ARRAY_AGG(
          COALESCE(redmine_id::text, id::text) || ': ' || COALESCE(title, 'Untitled')
        ) AS overdue_list
      FROM issues
      WHERE assigned_to_id = ANY(${memberIds})
        AND due_date IS NOT NULL
        AND due_date < CURRENT_DATE
        AND status NOT IN ('Closed', 'Resolved')
    `;
    const overdue = (overdueRows && overdueRows[0]) || { overdue_count: 0, overdue_list: null };

    // Blockers
    const blockerRows = await sql`
      SELECT
        COUNT(*)::int AS blocked_count,
        ARRAY_AGG(
          COALESCE(redmine_id::text, id::text) || ': ' || COALESCE(title, 'Untitled')
        ) AS blocked_list
      FROM issues
      WHERE assigned_to_id = ANY(${memberIds})
        AND status = 'Blocked'
    `;
    const blockers = (blockerRows && blockerRows[0]) || { blocked_count: 0, blocked_list: null };

    // New tickets created / assigned this period
    const newRows = await sql`
      SELECT COUNT(*)::int AS new_tickets
      FROM issues
      WHERE assigned_to_id = ANY(${memberIds})
        AND created_at >= ${sinceStr}::date
    `;
    const newTickets = (newRows && newRows[0] && newRows[0].new_tickets) || 0;

    // Members who did not log any time
    const noLogRows = await sql`
      SELECT u.name
      FROM users u
      WHERE u.id = ANY(${memberIds})
        AND u.id NOT IN (
          SELECT DISTINCT user_id FROM time_entries
          WHERE spent_on >= ${sinceStr}::date
        )
        AND u.id NOT IN (
          SELECT user_id FROM leave_records
          WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
        )
    `;
    const noLogMembers = noLogRows ? noLogRows.map((r) => r.name) : [];

    return {
      team,
      period: { from: sinceStr, to: new Date().toISOString().slice(0, 10), days: periodDays },
      members: memberNames,
      memberCount: members.length,
      ticketsCompleted: completed.completed,
      ticketsOnTime: completed.on_time,
      totalHoursLogged: Math.round(hours.total_hours * 100) / 100,
      usersLogging: hours.users_logging,
      overdueCount: overdue.overdue_count,
      overdueTickets: overdue.overdue_list || [],
      blockedCount: blockers.blocked_count,
      blockedTickets: blockers.blocked_list || [],
      newTickets,
      noLogMembers,
    };
  } catch (err) {
    console.error('reports.buildWeeklyReport: error:', err.message);
    return { team, error: err.message, data: null };
  }
}

// ────────────────────────────────────────────────────────────────
// generateWeeklyReport — AI-written natural language summary
// ────────────────────────────────────────────────────────────────
async function generateWeeklyReport(managerId) {
  const sql = getDb();

  try {
    // Determine scope: manager sees all teams, team_lead sees their team
    const userRows = await sql`
      SELECT role, team, display_name
      FROM dashboard_users
      WHERE id = ${managerId}
    `;

    if (!userRows || userRows.length === 0) {
      return { error: 'User not found' };
    }

    const user = userRows[0];
    const isManager = user.role === 'manager';

    // Get teams to report on
    let teams;
    if (isManager) {
      const teamRows = await sql`
        SELECT DISTINCT team FROM users WHERE team IS NOT NULL AND active = true
      `;
      teams = teamRows ? teamRows.map((r) => r.team) : [];
    } else {
      teams = user.team ? [user.team] : [];
    }

    if (teams.length === 0) {
      return { error: 'No teams found', report: null };
    }

    // Build raw data for each team
    const teamReports = [];
    for (const team of teams) {
      const data = await buildWeeklyReport(team, 7);
      teamReports.push(data);
    }

    // Ask AI to write a summary
    const dataStr = JSON.stringify(teamReports, null, 2);
    const prompt = `You are a project management analyst writing a weekly status report for ${user.display_name} (${user.role}).

Based on the following team data, write a concise, actionable weekly report. Use this structure:

1. **Executive Summary** — 2-3 sentences on overall status
2. **Highlights** — Top accomplishments
3. **Concerns** — Overdue tickets, blockers, missing timelogs
4. **Recommendations** — 2-3 specific action items

Team data:
${dataStr}

Keep it under 500 words. Use bullet points. Bold important numbers.`;

    const response = await chat([
      {
        role: 'system',
        content: 'You are a professional project management report writer. Be concise, data-driven, and actionable.',
      },
      { role: 'user', content: prompt },
    ]);

    const summary =
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content;

    return {
      generatedFor: user.display_name,
      role: user.role,
      teams,
      teamData: teamReports,
      summary: summary || 'Unable to generate AI summary. Raw data is available above.',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('reports.generateWeeklyReport: error:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  buildWeeklyReport,
  generateWeeklyReport,
};
