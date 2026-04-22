// POST /api/auth/register/finalize
// Consumes a ready pending_registrations row: creates the dashboard_users
// account, marks the pending row 'consumed', issues the JWT cookie, and
// returns the new user. Body: { code, finalize_token }.
//
// The finalize_token is a short-lived JWT minted by /status when the row
// flips to 'ready' — it proves the client already saw ready-state. We still
// re-check status in the DB as belt-and-braces against a stale/forged token.
const jwt = require('jsonwebtoken');
const { getDb } = require('../../../../lib/db');
const { createToken, setAuthCookie } = require('../../../../lib/auth');
const { resolveRole } = require('../../../../lib/roles');
const {
  getClientIp,
  rateLimit,
  sendError,
} = require('../../../../lib/register-helpers');

const CODE_RE = /^[0-9a-f]{32}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed');
  }

  try {
    const body = req.body || {};
    const { code, finalize_token } = body;

    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      return sendError(res, 400, 'INVALID_INPUT', 'code must be a 32-character hex string');
    }
    if (typeof finalize_token !== 'string' || finalize_token.length === 0) {
      return sendError(res, 400, 'INVALID_INPUT', 'finalize_token is required');
    }

    const sql = getDb();

    const ip = getClientIp(req);
    const rl = await rateLimit(sql, ip, 'finalize', 5, '1 hour');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendError(res, 429, 'RATE_LIMITED', 'Too many finalize attempts. Try again later.', {
        retry_after: rl.retryAfterSec,
      });
    }

    // Verify the signed finalize_token. Any failure (expired, bad sig, wrong
    // purpose, mismatched code) collapses to the same BAD_TOKEN response.
    let payload;
    try {
      payload = jwt.verify(finalize_token, process.env.JWT_SECRET);
    } catch (e) {
      return sendError(
        res,
        401,
        'BAD_TOKEN',
        'Finalize token invalid or expired. Re-verify your channel.'
      );
    }
    if (
      !payload ||
      payload.purpose !== 'finalize_registration' ||
      payload.code !== code
    ) {
      return sendError(
        res,
        401,
        'BAD_TOKEN',
        'Finalize token invalid or expired. Re-verify your channel.'
      );
    }

    const rows = await sql`
      SELECT p.id AS pending_id, p.linked_redmine_user_id, p.username,
             p.password_hash, p.email, p.email_verified, p.telegram_id,
             p.verified_channel, p.status, p.expires_at,
             u.id AS user_id, u.name, u.email AS user_email,
             u.team, u.is_team_lead
      FROM pending_registrations p
      JOIN users u ON u.id = p.linked_redmine_user_id
      WHERE p.code = ${code}
    `;
    if (rows.length === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Registration session not found');
    }
    const row = rows[0];

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return sendError(res, 410, 'SESSION_EXPIRED', 'Registration session expired. Start again.');
    }
    if (row.status !== 'ready') {
      return sendError(res, 409, 'NOT_READY', "This registration isn't verified yet");
    }

    const role = resolveRole({ is_team_lead: row.is_team_lead }, row.username);
    const telegramId = row.verified_channel === 'telegram' ? row.telegram_id : null;

    // Atomic-ish creation. Codebase convention (see admin/dashboard-users.js)
    // is sequential tagged-template writes rather than explicit transactions.
    // Uniqueness on dashboard_users + the partial unique index on
    // pending_registrations (status='awaiting_verification') means a second
    // concurrent finalize will either lose the INSERT race (unique constraint)
    // or see status='consumed' below.
    let inserted;
    try {
      inserted = await sql`
        INSERT INTO dashboard_users (
          username, password_hash, display_name, role, team,
          linked_redmine_user_id, telegram_id, active
        ) VALUES (
          ${row.username}, ${row.password_hash}, ${row.name}, ${role}, ${row.team || null},
          ${row.linked_redmine_user_id},
          ${telegramId},
          true
        )
        RETURNING id, username, display_name, role, team
      `;
    } catch (e) {
      // Postgres unique_violation is SQLSTATE 23505. Any uniqueness failure
      // here means someone else won the race (or /start missed a clash).
      // Do NOT consume the pending row — a legitimate duplicate attempt
      // should surface cleanly as already-registered.
      const msg = String(e && (e.code || e.message) || '');
      if (msg.includes('23505') || /duplicate key|unique/i.test(msg)) {
        return sendError(res, 409, 'ALREADY_REGISTERED', 'This account is already registered');
      }
      throw e;
    }

    const newUser = inserted[0];

    await sql`
      UPDATE pending_registrations
      SET status = 'consumed'
      WHERE id = ${row.pending_id} AND status = 'ready'
    `;

    const userForToken = {
      id: newUser.id,
      username: newUser.username,
      display_name: newUser.display_name,
      role: newUser.role,
      team: newUser.team,
    };
    const token = createToken(userForToken);
    setAuthCookie(res, token);

    return res.status(200).json({ user: userForToken });
  } catch (err) {
    console.error('register/finalize error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to finalize registration');
  }
}
