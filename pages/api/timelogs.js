import { getDb } from '../../lib/db';
const { getCurrentUser } = require('../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { range = 'daily', from, to } = req.query;

  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const sql = getDb();
    const isTeamLead = user.role === 'team_lead';
    const team = user.team;

    const logs = isTeamLead
      ? await sql`
          SELECT
            u.id, u.name, u.team, u.initials,
            COALESCE(SUM(te.hours), 0)                  AS hours,
            COALESCE(SUM(te.hours), 0) > 0              AS logged,
            COUNT(DISTINCT te.spent_on)                  AS days_logged
          FROM users u
          LEFT JOIN time_entries te ON te.user_id = u.id AND (
            (${range} = 'daily' AND te.spent_on = CURRENT_DATE) OR
            (${range} = 'weekly' AND te.spent_on >= date_trunc('week', CURRENT_DATE)) OR
            (${range} = 'monthly' AND te.spent_on >= date_trunc('month', CURRENT_DATE)) OR
            (${range} = 'quarterly' AND te.spent_on >= date_trunc('quarter', CURRENT_DATE)) OR
            (${range} = 'yearly' AND te.spent_on >= date_trunc('year', CURRENT_DATE)) OR
            (${range} = 'custom' AND te.spent_on BETWEEN ${from}::date AND ${to}::date)
          )
          WHERE u.active = true AND u.team = ${team}
          GROUP BY u.id, u.name, u.team, u.initials
          ORDER BY u.team, u.name
        `
      : await sql`
          SELECT
            u.id, u.name, u.team, u.initials,
            COALESCE(SUM(te.hours), 0)                  AS hours,
            COALESCE(SUM(te.hours), 0) > 0              AS logged,
            COUNT(DISTINCT te.spent_on)                  AS days_logged
          FROM users u
          LEFT JOIN time_entries te ON te.user_id = u.id AND (
            (${range} = 'daily' AND te.spent_on = CURRENT_DATE) OR
            (${range} = 'weekly' AND te.spent_on >= date_trunc('week', CURRENT_DATE)) OR
            (${range} = 'monthly' AND te.spent_on >= date_trunc('month', CURRENT_DATE)) OR
            (${range} = 'quarterly' AND te.spent_on >= date_trunc('quarter', CURRENT_DATE)) OR
            (${range} = 'yearly' AND te.spent_on >= date_trunc('year', CURRENT_DATE)) OR
            (${range} = 'custom' AND te.spent_on BETWEEN ${from}::date AND ${to}::date)
          )
          WHERE u.active = true
          GROUP BY u.id, u.name, u.team, u.initials
          ORDER BY u.team, u.name
        `;

    const total_hours = logs.reduce((s, l) => s + parseFloat(l.hours), 0);
    const logged_count = logs.filter(l => l.logged).length;
    const missing = logs.filter(l => !l.logged);

    res.status(200).json({
      logs,
      summary: {
        total_hours: Math.round(total_hours * 10) / 10,
        logged_count,
        missing_count: missing.length,
        missing_names: missing.map(m => m.name),
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
