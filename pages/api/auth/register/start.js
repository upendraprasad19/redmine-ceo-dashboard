// POST /api/auth/register/start
// Public endpoint (no auth): validate inputs, rate-limit per IP,
// expire any prior pending row for this user, insert a fresh one,
// and return { code, expires_at } for the verification step.
const { getDb } = require('../../../../lib/db');
const { hashPassword } = require('../../../../lib/auth');
const { normalizeEmail } = require('../../../../lib/email-utils');
const {
  generateCode,
  getClientIp,
  rateLimit,
  sendError,
} = require('../../../../lib/register-helpers');

const USERNAME_RE = /^[a-zA-Z0-9._-]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed');
  }

  try {
    const sql = getDb();

    // Rate-limit first so input validation errors don't leak useful info
    // to attackers faster than the limiter can catch them.
    const ip = getClientIp(req);
    const rl = await rateLimit(sql, ip, 'start', 10, '1 hour');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendError(res, 429, 'RATE_LIMITED', 'Too many registration attempts. Try again later.', {
        retry_after: rl.retryAfterSec,
      });
    }

    const body = req.body || {};
    // TODO Phase 7: verify signed req_token from access-request approval,
    // link to access_request.id. For now the token is ignored.
    const { redmine_user_id, username, password, email } = body;

    // --- Input validation ---------------------------------------------------
    const redmineUserId = Number(redmine_user_id);
    if (!Number.isInteger(redmineUserId) || redmineUserId <= 0) {
      return sendError(res, 400, 'INVALID_INPUT', 'redmine_user_id must be a positive integer');
    }
    if (typeof username !== 'string' || username.length < 3 || username.length > 32 || !USERNAME_RE.test(username)) {
      return sendError(
        res,
        400,
        'INVALID_INPUT',
        'username must be 3–32 chars, letters/digits/._- only'
      );
    }
    if (typeof password !== 'string' || password.length < 8) {
      return sendError(res, 400, 'INVALID_INPUT', 'password must be at least 8 characters');
    }
    if (typeof email !== 'string' || email.trim() === '') {
      return sendError(res, 400, 'INVALID_INPUT', 'email is required');
    }
    const normEmail = normalizeEmail(email);
    if (!normEmail || !normEmail.includes('@')) {
      return sendError(res, 400, 'INVALID_INPUT', 'email is not a valid address');
    }

    // --- Business checks ----------------------------------------------------
    const userRows = await sql`
      SELECT id, name, email FROM users WHERE id = ${redmineUserId} AND active = true
    `;
    if (userRows.length === 0) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'No active Redmine user with that id');
    }

    const clash = await sql`
      SELECT 1 FROM dashboard_users
      WHERE linked_redmine_user_id = ${redmineUserId}
         OR LOWER(username) = LOWER(${username})
      LIMIT 1
    `;
    if (clash.length > 0) {
      // Intentionally vague: don't distinguish username-taken from already-linked.
      return sendError(res, 409, 'ALREADY_REGISTERED', 'This account cannot be registered');
    }

    // Expire any prior live pending row for this user or email so the partial
    // unique indexes from migration 021 don't reject the fresh insert, and so
    // someone who typed the wrong email can restart cleanly.
    await sql`
      UPDATE pending_registrations
      SET status = 'expired'
      WHERE (linked_redmine_user_id = ${redmineUserId} OR LOWER(email) = LOWER(${normEmail}))
        AND status = 'awaiting_verification'
    `;

    const code = generateCode();
    const passwordHash = await hashPassword(password);

    const inserted = await sql`
      INSERT INTO pending_registrations
        (code, linked_redmine_user_id, username, password_hash, email)
      VALUES (${code}, ${redmineUserId}, ${username}, ${passwordHash}, ${normEmail})
      RETURNING code, expires_at
    `;

    const row = inserted[0];
    return res.status(200).json({
      code: row.code,
      expires_at: row.expires_at,
    });
  } catch (err) {
    console.error('register/start error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to start registration');
  }
}
