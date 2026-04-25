/**
 * lib/email.js
 * Resend HTTP API transport. Keeps sendReport / sendText signatures so
 * existing callers (cron jobs, forgot-password flow, etc.) don't change.
 *
 * Self-registration callers also import sendOtp, sendAccessApproved, and
 * sendAccessRejected from here — they're thin wrappers that build the
 * template body (with HTML-escape + URL-scheme defenses) and delegate
 * to the same resendSend helper.
 *
 * Env required:
 *   RESEND_API_KEY
 *   EMAIL_FROM   (must be a verified sender on your Resend domain)
 */

const { normalizeEmail } = require('./email-utils');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function normalizeTo(to) {
  if (Array.isArray(to)) return to.map(normalizeEmail).filter(Boolean);
  const n = normalizeEmail(to);
  return n ? [n] : [];
}

async function resendSend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');
  if (!from) throw new Error('EMAIL_FROM not set');

  const recipients = normalizeTo(to);
  if (recipients.length === 0) throw new Error('No valid recipient after normalization');

  const body = { from, to: recipients, subject };
  if (html) body.html = html;
  if (text) body.text = text;

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${data?.message || data?.error || 'unknown'}`);
  }
  return data; // { id: "..." }
}

async function sendReport(to, subject, html) {
  return resendSend({ to, subject, html });
}

async function sendText(to, subject, text) {
  return resendSend({ to, subject, text });
}

// Back-compat: if some caller ever imported getTransporter, return a stub that
// mimics the Nodemailer shape so it fails loudly rather than silently.
function getTransporter() {
  return {
    sendMail: async ({ to, subject, html, text }) => resendSend({ to, subject, html, text }),
  };
}

// ---------------------------------------------------------------------------
// Self-registration transactional templates
// ---------------------------------------------------------------------------

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required and must be a non-empty string`);
  }
}

// Minimal HTML-entity escape for values interpolated into HTML templates.
// Prevents an attacker-controlled name or malformed URL from injecting
// markup or breaking out of an attribute context.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Reject anything that isn't an http(s) URL so a javascript: link can't
// become a CTA button in clients that honor href.
function requireHttpUrl(value, name) {
  requireString(value, name);
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`${name} must be an http(s) URL`);
  }
}

async function sendOtp(to, code) {
  requireString(to, 'to');
  requireString(code, 'code');
  const subject = 'Your RedMine Dashboard verification code';
  const text = `Your verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <p>Your verification code is:</p>
    <p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:16px 0;background:#f4f4f5;padding:16px;text-align:center;border-radius:6px">${code}</p>
    <p style="color:#555">This code expires in 10 minutes.</p>
    <p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
  </div>`;
  return resendSend({ to, subject, html, text });
}

async function sendAccessApproved(to, name, link) {
  requireString(to, 'to');
  requireString(name, 'name');
  requireHttpUrl(link, 'link');
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);
  const subject = 'Your RedMine Dashboard access is ready';
  const text = `Hi ${name},\n\nYour access has been approved. Click the link below to finish setting up your account:\n\n${link}\n\nThis link expires in 7 days.`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
    <p>Hi ${safeName},</p>
    <p>Your access has been approved. Click the button below to finish setting up your account.</p>
    <p style="margin:24px 0"><a href="${safeLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">Finish setup</a></p>
    <p style="color:#555;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${safeLink}</span></p>
    <p style="color:#888;font-size:13px">This link expires in 7 days.</p>
  </div>`;
  return resendSend({ to, subject, html, text });
}

async function sendAccessRejected(to, name) {
  requireString(to, 'to');
  requireString(name, 'name');
  const safeName = escapeHtml(name);
  const subject = 'Your RedMine Dashboard access request';
  const text = `Hi ${name},\n\nYour access request was not approved. Please reach out to your project manager directly for more information.`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
    <p>Hi ${safeName},</p>
    <p>Your access request was not approved. Please reach out to your project manager directly for more information.</p>
  </div>`;
  return resendSend({ to, subject, html, text });
}

module.exports = {
  sendReport,
  sendText,
  getTransporter,
  sendOtp,
  sendAccessApproved,
  sendAccessRejected,
};
