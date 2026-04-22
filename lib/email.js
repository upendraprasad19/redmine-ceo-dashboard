/**
 * lib/email.js
 * Nodemailer SMTP transport for sending reports and notifications.
 */

const nodemailer = require('nodemailer');
const { normalizeEmail } = require('./email-utils');

let transporter;

function normalizeTo(to) {
  if (Array.isArray(to)) return to.map(normalizeEmail).filter(Boolean);
  return normalizeEmail(to);
}

/**
 * Get or create a reusable SMTP transporter.
 */
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send an HTML report email.
 * @param {string|string[]} to - Recipient(s)
 * @param {string} subject - Email subject
 * @param {string} html - HTML body
 */
async function sendReport(to, subject, html) {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: normalizeTo(to),
    subject,
    html,
  });
}

/**
 * Send a plain-text email.
 * @param {string|string[]} to - Recipient(s)
 * @param {string} subject - Email subject
 * @param {string} text - Plain text body
 */
async function sendText(to, subject, text) {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: normalizeTo(to),
    subject,
    text,
  });
}

module.exports = { sendReport, sendText, getTransporter };
