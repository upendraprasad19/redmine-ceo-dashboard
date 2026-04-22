/**
 * lib/email.js
 * Two concerns live here:
 *  1. SMTP transport via nodemailer (sendReport / sendText) — used for
 *     scheduled reports and password-reset emails.
 *  2. Transactional Resend wrapper (sendOtp / sendAccessApproved /
 *     sendAccessRejected) — used by the self-registration flow.
 *
 * Both paths are side-effect-free at require() time: the nodemailer
 * transporter and Resend client are lazily constructed on first send.
 */

const nodemailer = require('nodemailer');
const { normalizeEmail } = require('./email-utils');

let transporter;

function normalizeTo(to) {
  if (Array.isArray(to)) return to.map(normalizeEmail).filter(Boolean);
  return normalizeEmail(to);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function sendReport(to, subject, html) {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: normalizeTo(to), subject, html,
  });
}

async function sendText(to, subject, text) {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: normalizeTo(to), subject, text,
  });
}

// ---------- Resend transactional wrapper (self-registration) ----------

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

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey) throw new Error('Email disabled: RESEND_API_KEY not set');
  if (!from) throw new Error('Email disabled: EMAIL_FROM not set');
  const normalizedTo = normalizeEmail(to);
  if (!normalizedTo) throw new Error('to is not a valid email address');
  // Dynamic import rather than require() so test runners (vitest) that mock
  // ESM modules can intercept this load path too.
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({ from, to: normalizedTo, subject, html, text });
  if (result && result.error) {
    throw new Error(`Resend send failed: ${result.error.message || 'unknown error'}`);
  }
  return result;
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
  return sendViaResend({ to, subject, html, text });
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
  return sendViaResend({ to, subject, html, text });
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
  return sendViaResend({ to, subject, html, text });
}

module.exports = {
  sendReport, sendText, getTransporter,
  sendOtp, sendAccessApproved, sendAccessRejected,
};
