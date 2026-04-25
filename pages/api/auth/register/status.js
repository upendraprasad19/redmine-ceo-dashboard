// GET /api/auth/register/status?code=<32-hex>
// Polled by the wizard (~every 2s). Returns current state of the pending
// registration. When status='ready', also returns a short-lived (5-min)
// signed finalize_token the client passes back to /finalize. No rate limit:
// this endpoint is polled frequently and does minimal work.
const jwt = require('jsonwebtoken');
const { getDb } = require('../../../../lib/db');
const { sendError } = require('../../../../lib/register-helpers');

const CODE_RE = /^[0-9a-f]{32}$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed');
  }

  try {
    const code = req.query && typeof req.query.code === 'string' ? req.query.code : '';
    if (!CODE_RE.test(code)) {
      return sendError(res, 400, 'INVALID_INPUT', 'code must be a 32-character hex string');
    }

    const sql = getDb();
    const rows = await sql`
      SELECT status, verified_channel, expires_at
      FROM pending_registrations
      WHERE code = ${code}
    `;
    if (rows.length === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Registration session not found');
    }
    const row = rows[0];

    // Server-side expiry overrides stored status. A cleanup job may not have
    // flipped the row to 'expired' yet, but from the client's POV it is.
    const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    const expired = expiresAtMs > 0 && expiresAtMs < Date.now();
    const effectiveStatus = expired ? 'expired' : row.status;

    const body = {
      status: effectiveStatus,
      expires_at:
        row.expires_at instanceof Date
          ? row.expires_at.toISOString()
          : new Date(row.expires_at).toISOString(),
    };

    if (effectiveStatus === 'ready') {
      body.verified_channel = row.verified_channel;
      body.finalize_token = jwt.sign(
        { code, purpose: 'finalize_registration' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
    }

    return res.status(200).json(body);
  } catch (err) {
    console.error('register/status error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to read registration status');
  }
}
