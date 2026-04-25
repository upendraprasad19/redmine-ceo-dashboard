// POST /api/auth/register/send-email-otp
// Public endpoint: generates a 6-digit OTP, stores it on the pending row
// with a 10-minute expiry, and dispatches via Resend.
// Used when the user chooses "Verify via Email" on the wizard, including
// the "resend" button.
const { getDb } = require('../../../../lib/db');
const { sendOtp } = require('../../../../lib/email');
const {
  generateOtp,
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
    const sql = getDb();

    // Rate-limit first (matches the convention in start.js). 3 per hour per
    // IP is enough for legitimate "didn't get it, try again" clicks while
    // still blocking total spam.
    const ip = getClientIp(req);
    const rl = await rateLimit(sql, ip, 'send_email_otp', 3, '1 hour');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendError(res, 429, 'RATE_LIMITED', 'Too many OTP requests. Try again later.', {
        retry_after: rl.retryAfterSec,
      });
    }

    const body = req.body || {};
    const { code } = body;

    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      return sendError(res, 400, 'INVALID_INPUT', 'code must be a 32-character hex string');
    }

    const rows = await sql`
      SELECT id, email, status, expires_at
      FROM pending_registrations WHERE code = ${code}
    `;
    if (rows.length === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Registration session not found');
    }
    const pending = rows[0];

    if (pending.status !== 'awaiting_verification') {
      // Do not leak the actual status value.
      return sendError(res, 409, 'INVALID_STATE', 'This registration is already verified or expired');
    }
    if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
      return sendError(res, 410, 'SESSION_EXPIRED', 'Registration session expired. Start again.');
    }

    const otp = generateOtp();

    // Defensive re-check of status in WHERE so a race can't overwrite a
    // row that's already been flipped to 'ready'.
    await sql`
      UPDATE pending_registrations
      SET email_otp = ${otp},
          email_otp_expires_at = NOW() + INTERVAL '10 minutes',
          email_otp_attempts = 0
      WHERE id = ${pending.id}
        AND status = 'awaiting_verification'
    `;

    try {
      await sendOtp(pending.email, otp);
    } catch (mailErr) {
      // Do NOT revert the stored OTP: if the user clicks "resend" when
      // Resend is flaky, we want the new OTP stored so a later success works.
      console.error('send-email-otp: sendOtp failed:', mailErr);
      // A provider outage shouldn't consume the user's 3/hr budget — compensate
      // by rolling back the increment that rateLimit() just applied. Clamped
      // at zero so a row that was just inserted (attempts=1) goes back to 0.
      await sql`
        UPDATE register_rate_limit
        SET attempts = GREATEST(attempts - 1, 0)
        WHERE ip = ${ip} AND bucket = 'send_email_otp'
      `;
      return sendError(
        res,
        502,
        'EMAIL_FAILED',
        'Could not send the verification email. Try again in a moment.'
      );
    }

    return res.status(200).json({ sent: true, expires_in_seconds: 600 });
  } catch (err) {
    console.error('register/send-email-otp error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to send verification email');
  }
}
