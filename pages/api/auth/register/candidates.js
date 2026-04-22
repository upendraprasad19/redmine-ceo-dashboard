// GET /api/auth/register/candidates
// Public endpoint (no auth): returns active Redmine users not yet linked to a
// dashboard account, each with a suggested role. Used by the self-registration
// UI to let a user pick their own identity.
const { getDb } = require('../../../../lib/db');
const { resolveRole } = require('../../../../lib/roles');
const { sendError } = require('../../../../lib/register-helpers');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed');
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT u.id, u.name, u.team, u.email, u.is_team_lead
      FROM users u
      WHERE u.active = true
        AND NOT EXISTS (
          SELECT 1 FROM dashboard_users du
          WHERE du.linked_redmine_user_id = u.id
        )
      ORDER BY u.name ASC
    `;

    const candidates = rows.map((r) => ({
      id: r.id,
      name: r.name,
      team: r.team,
      email: r.email,
      is_team_lead: !!r.is_team_lead,
      // No username yet during registration → resolveRole falls back to
      // team_lead / developer (never 'manager' without a username match).
      suggested_role: resolveRole(r, null),
    }));

    return res.status(200).json({ candidates });
  } catch (err) {
    console.error('register/candidates error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to load candidates');
  }
}
