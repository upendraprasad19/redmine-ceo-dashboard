// GET /api/auth/register/candidate-from-token?token=<jwt>
// Public endpoint: verifies a one-click approval JWT (signed by the Redmine
// sync when an access request is resolved) and returns the locked candidate
// details so the registration wizard can skip the name-picker step.
const jwt = require('jsonwebtoken');
const { getDb } = require('../../../../lib/db');
const { resolveRole } = require('../../../../lib/roles');
const { sendError } = require('../../../../lib/register-helpers');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed');
  }

  try {
    const token = req.query.token;
    if (typeof token !== 'string' || token.trim() === '') {
      return sendError(res, 400, 'INVALID_INPUT', 'token is required');
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return sendError(res, 401, 'BAD_TOKEN', 'Token invalid or expired. Ask for a new approval email.');
    }

    if (
      !payload ||
      payload.purpose !== 'complete_registration' ||
      typeof payload.redmine_user_id !== 'number'
    ) {
      return sendError(res, 401, 'BAD_TOKEN', 'Token invalid or expired. Ask for a new approval email.');
    }

    const sql = getDb();
    const rows = await sql`
      SELECT id, name, team, email, is_team_lead
      FROM users
      WHERE id = ${payload.redmine_user_id} AND active = true
      LIMIT 1
    `;
    if (rows.length === 0) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'No active Redmine user for this token');
    }

    const existing = await sql`
      SELECT 1 FROM dashboard_users
      WHERE linked_redmine_user_id = ${payload.redmine_user_id}
      LIMIT 1
    `;
    if (existing.length > 0) {
      return sendError(res, 409, 'ALREADY_REGISTERED', 'This account is already registered. Try signing in.');
    }

    const row = rows[0];
    const candidate = {
      id: row.id,
      name: row.name,
      team: row.team,
      email: row.email,
      is_team_lead: !!row.is_team_lead,
      suggested_role: resolveRole(row, null),
    };

    return res.status(200).json({
      candidate,
      req_id: payload.req_id,
    });
  } catch (err) {
    console.error('register/candidate-from-token error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to resolve candidate from token');
  }
}
