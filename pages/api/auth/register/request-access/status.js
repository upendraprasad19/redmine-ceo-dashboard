// GET /api/auth/register/request-access/status?email=<addr>
// Public endpoint: the confirmation screen polls this after POST-ing an
// access request, so the user can see when Upendra has approved/rejected
// without logging in. We deliberately return { found: false } (not 404)
// when there's no row — a 404 looks like an error to polling UIs.
const { getDb } = require('../../../../../lib/db');
const { normalizeEmail } = require('../../../../../lib/email-utils');
const {
  getClientIp,
  rateLimit,
  sendError,
} = require('../../../../../lib/register-helpers');

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed');
  }

  try {
    const rawEmail = req.query && req.query.email;
    if (typeof rawEmail !== 'string' || rawEmail.trim() === '') {
      return sendError(res, 400, 'INVALID_INPUT', 'email is required');
    }
    const normalizedEmail = normalizeEmail(rawEmail);
    if (!normalizedEmail || !EMAIL_SHAPE_RE.test(normalizedEmail)) {
      return sendError(res, 400, 'INVALID_INPUT', 'email is not a valid address');
    }

    const sql = getDb();

    // Rate-limit AFTER email validation here: the bucket is generous (60/hr),
    // and we don't want a malformed-email polling loop to eat the whole quota
    // and then lock out the legitimate success poll.
    const ip = getClientIp(req);
    const rl = await rateLimit(sql, ip, 'request_access_status', 60, '1 hour');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendError(res, 429, 'RATE_LIMITED', 'Too many status checks. Try again later.', {
        retry_after: rl.retryAfterSec,
      });
    }

    const rows = await sql`
      SELECT id, status, created_at, reviewed_at
      FROM access_requests
      WHERE LOWER(email) = LOWER(${normalizedEmail})
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(200).json({ found: false });
    }
    const row = rows[0];
    return res.status(200).json({
      found: true,
      status: row.status,
      created_at: row.created_at,
      reviewed_at: row.reviewed_at,
    });
  } catch (err) {
    console.error('register/request-access/status error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to fetch request status');
  }
}
