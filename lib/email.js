/**
 * lib/email.js
 * Resend HTTP API transport. Keeps sendReport / sendText signatures so
 * existing callers (cron jobs, forgot-password flow, etc.) don't change.
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

module.exports = { sendReport, sendText, getTransporter };
