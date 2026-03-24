/**
 * scripts/notify-due-tickets.js
 *
 * Sends Telegram + Email alerts for tickets due today or tomorrow.
 * Run daily at 9:00 AM via Windows Task Scheduler or Vercel Cron.
 *
 * Usage:  node scripts/notify-due-tickets.js
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { sendTelegramMessage } from '../lib/telegram.js';
import { sendEmail } from '../lib/mailer.js';

const sql = neon(process.env.DATABASE_URL);
const TODAY = new Date().toISOString().split('T')[0];
const TOMORROW = new Date(Date.now() + 86400000).toISOString().split('T')[0];

async function alreadyNotified(type, refId, channel) {
  const rows = await sql`
    SELECT id FROM notification_log
    WHERE type = ${type}
      AND ref_id = ${refId}
      AND channel = ${channel}
      AND sent_date = CURRENT_DATE
    LIMIT 1
  `;
  return rows.length > 0;
}

async function logNotification(type, refId, channel) {
  await sql`
    INSERT INTO notification_log (type, ref_id, channel, sent_date)
    VALUES (${type}, ${refId}, ${channel}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;
}

async function run() {
  console.log(`\n🔔 Due-ticket notifier — ${TODAY}`);

  // Fetch tickets due today or tomorrow, not yet closed
  const tickets = await sql`
    SELECT
      i.id,
      i.redmine_id,
      i.title,
      i.due_date,
      i.priority,
      i.status,
      p.name  AS project_name,
      u.name  AS assigned_name,
      u.email AS assigned_email,
      u.telegram_chat_id
    FROM issues i
    LEFT JOIN users    u ON u.id = i.assigned_to_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.due_date IN (${TODAY}, ${TOMORROW})
      AND i.status NOT IN ('Closed', 'Resolved')
      AND u.id IS NOT NULL
    ORDER BY i.due_date ASC, i.priority DESC
  `;

  console.log(`  Found ${tickets.length} ticket(s) due today or tomorrow\n`);

  for (const t of tickets) {
    const dueLabel = t.due_date === TODAY ? '🔴 *TODAY*' : '🟡 *TOMORROW*';
    const msg =
      `${dueLabel} — Ticket Due Reminder\n\n` +
      `*[TK-${t.redmine_id}]* ${t.title}\n` +
      `📁 Project: ${t.project_name}\n` +
      `🏷 Priority: ${t.priority}  |  Status: ${t.status}\n` +
      `📅 Due: ${t.due_date}\n\n` +
      `Please update the status on Redmine!`;

    // ── Telegram ──────────────────────────────────────────────
    if (t.telegram_chat_id) {
      if (!(await alreadyNotified('due_ticket', t.id, 'telegram'))) {
        await sendTelegramMessage(t.telegram_chat_id, msg);
        await logNotification('due_ticket', t.id, 'telegram');
        console.log(`  📱 Telegram → ${t.assigned_name} (TK-${t.redmine_id})`);
      } else {
        console.log(`  ⏩ Telegram already sent today for TK-${t.redmine_id}`);
      }
    } else {
      console.log(`  ⚠️  No Telegram for ${t.assigned_name} (TK-${t.redmine_id})`);
    }

    // ── Email ─────────────────────────────────────────────────
    if (t.assigned_email) {
      if (!(await alreadyNotified('due_ticket', t.id, 'email'))) {
        const subject = `[${t.due_date === TODAY ? 'DUE TODAY' : 'DUE TOMORROW'}] ${t.title}`;
        const html = `
          <div style="font-family:sans-serif;max-width:600px;margin:auto">
            <div style="background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0">
              <h2 style="margin:0">⏰ ${t.due_date === TODAY ? 'Ticket Due Today' : 'Ticket Due Tomorrow'}</h2>
            </div>
            <div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 8px 8px">
              <p><strong>Ticket:</strong> TK-${t.redmine_id} — ${t.title}</p>
              <p><strong>Project:</strong> ${t.project_name}</p>
              <p><strong>Priority:</strong> ${t.priority} &nbsp;|&nbsp; <strong>Status:</strong> ${t.status}</p>
              <p><strong>Due Date:</strong> ${t.due_date}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
              <p style="color:#6b7280;font-size:13px">
                Please update the ticket status on Redmine so the project manager stays informed.
                <br>Assigned to: <strong>${t.assigned_name}</strong>
              </p>
            </div>
          </div>`;
        await sendEmail(t.assigned_email, subject, html);
        await logNotification('due_ticket', t.id, 'email');
        console.log(`  📧 Email → ${t.assigned_email} (TK-${t.redmine_id})`);
      } else {
        console.log(`  ⏩ Email already sent today for TK-${t.redmine_id}`);
      }
    }
  }

  console.log('\n✅ Due-ticket notifier done!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
