/**
 * lib/mailer.js
 * Nodemailer wrapper for sending email notifications
 */

import nodemailer from 'nodemailer';

function getTransport() {
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

/**
 * @param {string} to   - recipient email
 * @param {string} subject
 * @param {string} html - HTML body
 */
export async function sendEmail(to, subject, html) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[Mailer] EMAIL_USER / EMAIL_PASS not set — skipping email to', to);
    return false;
  }
  if (!to) {
    console.warn('[Mailer] No recipient email — skipping');
    return false;
  }

  try {
    const transporter = getTransport();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
    console.log(`[Mailer] Sent "${subject}" to ${to}`);
    return true;
  } catch (err) {
    console.error(`[Mailer] Failed to send to ${to}:`, err.message);
    return false;
  }
}
