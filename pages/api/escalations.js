const { getCurrentUser } = require('../../lib/auth');
const { getDb } = require('../../lib/db');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const sql = getDb();
    const isTeamLead = user.role === 'team_lead';
    const team = user.team;

    const escalations = isTeamLead
      ? await sql`
          SELECT
            el.id,
            el.raised_by,
            el.escalated_to,
            el.rule_triggered,
            el.actioned,
            el.action_taken,
            el.triggered_at,
            du1.display_name AS raised_by_name,
            du2.display_name AS escalated_to_name
          FROM escalation_log el
          LEFT JOIN dashboard_users du1 ON du1.id = el.raised_by
          LEFT JOIN dashboard_users du2 ON du2.id = el.escalated_to
          WHERE du1.team = ${team} OR du2.team = ${team}
          ORDER BY el.triggered_at DESC
          LIMIT 20
        `
      : await sql`
          SELECT
            el.id,
            el.raised_by,
            el.escalated_to,
            el.rule_triggered,
            el.actioned,
            el.action_taken,
            el.triggered_at,
            du1.display_name AS raised_by_name,
            du2.display_name AS escalated_to_name
          FROM escalation_log el
          LEFT JOIN dashboard_users du1 ON du1.id = el.raised_by
          LEFT JOIN dashboard_users du2 ON du2.id = el.escalated_to
          ORDER BY el.triggered_at DESC
          LIMIT 20
        `;

    res.status(200).json({ escalations });
  } catch (err) {
    console.error('Escalations error:', err);
    res.status(500).json({ error: err.message });
  }
}
