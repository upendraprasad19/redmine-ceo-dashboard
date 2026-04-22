// POST /api/auth/register/request-access
// Public endpoint (no auth): a prospective user whose name isn't in the
// Redmine-user dropdown asks to be let in. We validate, dedupe against any
// pending/approved request for the same email, insert a row, and fire a
// best-effort Telegram DM to Upendra so he can review in the admin panel.
//
// Notify failure must not fail the HTTP request — the row is already in the
// table and will surface in /admin/access-requests.
const { getDb } = require('../../../../lib/db');
const { normalizeEmail } = require('../../../../lib/email-utils');
const { sendTelegramMessage } = require('../../../../lib/telegram');
const {
  getClientIp,
  rateLimit,
  sendError,
} = require('../../../../lib/register-helpers');

// Same cheap shape check as register/start.js — not RFC-5322 but catches
// obviously malformed input before we hit the DB.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Upendra's Telegram chat ID. Env var kept configurable in case it ever needs
// rotating without a redeploy.
const UPENDRA_TELEGRAM_ID = process.env.UPENDRA_TELEGRAM_ID || '8674834540';

// Dashboard URL for the review link inside the Telegram DM. The project
// doesn't yet have a canonical env var for its public origin — fall back
// to a relative path if nothing is set (Upendra still sees the domain in
// his browser tab).
function buildReviewUrl() {
  const base = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (base && typeof base === 'string' && base.trim() !== '') {
    return `${base.replace(/\/+$/, '')}/admin/access-requests`;
  }
  return '/admin/access-requests';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed');
  }

  try {
    const sql = getDb();

    // Rate-limit before validation so probing for field errors is throttled too.
    const ip = getClientIp(req);
    const rl = await rateLimit(sql, ip, 'request_access', 3, '1 hour');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendError(res, 429, 'RATE_LIMITED', 'Too many access requests. Try again later.', {
        retry_after: rl.retryAfterSec,
      });
    }

    const body = req.body || {};
    const rawFullName = body.full_name;
    const rawEmail = body.email;
    const rawTeam = body.team;
    const rawMessage = body.message;

    // --- full_name ----------------------------------------------------------
    if (typeof rawFullName !== 'string') {
      return sendError(res, 400, 'INVALID_INPUT', 'full_name is required');
    }
    const fullName = rawFullName.trim();
    if (fullName === '') {
      return sendError(res, 400, 'INVALID_INPUT', 'full_name is required');
    }
    if (fullName.length > 120) {
      return sendError(res, 400, 'INVALID_INPUT', 'full_name must be at most 120 characters');
    }
    if (/[\r\n]/.test(fullName)) {
      return sendError(res, 400, 'INVALID_INPUT', 'full_name must not contain newlines');
    }
    if (fullName.includes('<')) {
      return sendError(res, 400, 'INVALID_INPUT', 'full_name must not contain HTML');
    }

    // --- email --------------------------------------------------------------
    if (typeof rawEmail !== 'string' || rawEmail.trim() === '') {
      return sendError(res, 400, 'INVALID_INPUT', 'email is required');
    }
    const normalizedEmail = normalizeEmail(rawEmail);
    if (!normalizedEmail || !EMAIL_SHAPE_RE.test(normalizedEmail)) {
      return sendError(res, 400, 'INVALID_INPUT', 'email is not a valid address');
    }

    // --- team (optional) ----------------------------------------------------
    let team = null;
    if (rawTeam != null && rawTeam !== '') {
      if (typeof rawTeam !== 'string') {
        return sendError(res, 400, 'INVALID_INPUT', 'team must be a string');
      }
      team = rawTeam.trim();
      if (team === '') {
        team = null;
      } else {
        if (team.length > 80) {
          return sendError(res, 400, 'INVALID_INPUT', 'team must be at most 80 characters');
        }
        if (/[\r\n]/.test(team)) {
          return sendError(res, 400, 'INVALID_INPUT', 'team must not contain newlines');
        }
      }
    }

    // --- message (optional) -------------------------------------------------
    let message = null;
    if (rawMessage != null && rawMessage !== '') {
      if (typeof rawMessage !== 'string') {
        return sendError(res, 400, 'INVALID_INPUT', 'message must be a string');
      }
      message = rawMessage.trim();
      if (message === '') {
        message = null;
      } else {
        if (message.length > 1000) {
          return sendError(res, 400, 'INVALID_INPUT', 'message must be at most 1000 characters');
        }
        if (message.includes('<')) {
          return sendError(res, 400, 'INVALID_INPUT', 'message must not contain HTML');
        }
      }
    }

    // --- Idempotency: don't create duplicate pending/approved for same email.
    // We silently succeed so the UI doesn't leak whether an email has already
    // asked, and so a double-submit doesn't spam Upendra's DMs.
    const existing = await sql`
      SELECT 1 FROM access_requests
      WHERE LOWER(email) = LOWER(${normalizedEmail})
        AND status IN ('pending', 'approved')
      LIMIT 1
    `;
    if (existing.length > 0) {
      return res.status(200).json({ ok: true, status: 'pending', duplicate: true });
    }

    const inserted = await sql`
      INSERT INTO access_requests (full_name, email, team, message, status)
      VALUES (${fullName}, ${normalizedEmail}, ${team}, ${message}, 'pending')
      RETURNING id, created_at
    `;
    const row = inserted[0];

    // Best-effort Telegram DM. Plain text — pass parseMode: '' so the helper
    // doesn't send Markdown (default) and choke on stray underscores/asterisks
    // in names or messages.
    const reviewUrl = buildReviewUrl();
    const notifyText =
      '🆕 New dashboard access request\n' +
      `Name: ${fullName}\n` +
      `Email: ${normalizedEmail}\n` +
      `Team: ${team || '—'}\n` +
      `Message: ${message || '(none)'}\n` +
      '\n' +
      `Review: ${reviewUrl}`;
    try {
      await sendTelegramMessage(UPENDRA_TELEGRAM_ID, notifyText, { parseMode: '' });
    } catch (err) {
      console.error('telegram notify failed:', err);
    }

    return res.status(200).json({
      ok: true,
      id: row.id,
      status: 'pending',
      duplicate: false,
    });
  } catch (err) {
    console.error('register/request-access error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to submit access request');
  }
}
