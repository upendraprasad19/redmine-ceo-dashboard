// POST /api/auth/register/verify-email
// Public endpoint: validates a submitted OTP against pending_registrations.
// On success, flips the pending row to status='ready' with
// verified_channel='email'. No IP-level rate limit — the per-row
// email_otp_attempts counter is the lockout (5 strikes and the row is
// expired).
const { getDb } = require('../../../../lib/db');
const { sendError } = require('../../../../lib/register-helpers');

const CODE_RE = /^[0-9a-f]{32}$/;
const OTP_RE = /^\d{6}$/;
const MAX_ATTEMPTS = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed');
  }

  try {
    const sql = getDb();
    const body = req.body || {};
    const { code, otp } = body;

    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      return sendError(res, 400, 'INVALID_INPUT', 'code must be a 32-character hex string');
    }
    if (typeof otp !== 'string' || !OTP_RE.test(otp)) {
      return sendError(res, 400, 'INVALID_INPUT', 'otp must be a 6-digit code');
    }

    const rows = await sql`
      SELECT id, email_otp, email_otp_expires_at, email_otp_attempts, status, expires_at
      FROM pending_registrations WHERE code = ${code}
    `;
    if (rows.length === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Registration session not found');
    }
    const pending = rows[0];

    const now = Date.now();

    // Session-level expiry takes priority over per-state checks: a row whose
    // expires_at has passed is effectively gone even if status never got
    // flipped by a cleanup job.
    if (pending.expires_at && new Date(pending.expires_at).getTime() < now) {
      return sendError(res, 410, 'SESSION_EXPIRED', 'Registration session expired. Start again.');
    }

    if (pending.status !== 'awaiting_verification') {
      return sendError(res, 409, 'INVALID_STATE', 'This registration is already verified or expired');
    }

    if (pending.email_otp === null || pending.email_otp === undefined) {
      return sendError(res, 400, 'OTP_NOT_SENT', 'Request an OTP first');
    }

    if (Number(pending.email_otp_attempts) >= MAX_ATTEMPTS) {
      // Burn the row: too many wrong guesses means they start over.
      await sql`
        UPDATE pending_registrations
        SET status = 'expired'
        WHERE id = ${pending.id}
          AND status = 'awaiting_verification'
      `;
      return sendError(
        res,
        403,
        'LOCKED',
        'Too many incorrect attempts. Please start registration again.'
      );
    }

    if (
      pending.email_otp_expires_at &&
      new Date(pending.email_otp_expires_at).getTime() < now
    ) {
      // Do not increment attempts for an expired OTP — that's a timing issue,
      // not a guessing attempt.
      return sendError(res, 410, 'OTP_EXPIRED', 'That code has expired. Request a new one.');
    }

    if (pending.email_otp !== otp) {
      const updated = await sql`
        UPDATE pending_registrations
        SET email_otp_attempts = email_otp_attempts + 1
        WHERE id = ${pending.id}
          AND status = 'awaiting_verification'
        RETURNING email_otp_attempts
      `;
      const newAttempts = updated.length > 0 ? Number(updated[0].email_otp_attempts) : MAX_ATTEMPTS;
      const attemptsLeft = Math.max(0, MAX_ATTEMPTS - newAttempts);
      return sendError(res, 401, 'BAD_OTP', 'Incorrect verification code', {
        attempts_left: attemptsLeft,
      });
    }

    // Success: belt-and-braces race check on all three predicates so a
    // concurrent writer can't flip the row twice or resurrect a stale OTP.
    await sql`
      UPDATE pending_registrations
      SET email_verified = true,
          verified_channel = 'email',
          status = 'ready'
      WHERE id = ${pending.id}
        AND status = 'awaiting_verification'
        AND email_otp = ${otp}
    `;

    return res.status(200).json({ verified: true });
  } catch (err) {
    console.error('register/verify-email error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to verify email');
  }
}
