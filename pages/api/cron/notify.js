/**
 * pages/api/cron/notify.js
 *
 * HTTP endpoint to trigger notification jobs.
 * Called by Windows Task Scheduler / Vercel Cron / cron-job.org
 *
 * Usage:
 *   GET /api/cron/notify?type=due_tickets
 *   GET /api/cron/notify?type=timelog_reminder
 *
 * Secured with x-sync-secret header or ?secret= query param.
 */

import { getDb } from '../../../lib/db';
import { sendTelegramMessage } from '../../../lib/telegram';
import { sendEmail } from '../../../lib/mailer';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }

  // Verify secret
  const secret = req.headers['x-sync-secret'] || req.query.secret;
  if (!secret || secret !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const type = req.query.type || 'due_tickets';
  const sql  = getDb();

  try {
    if (type === 'due_tickets') {
      await runDueTicketAlerts(sql);
    } else if (type === 'timelog_reminder') {
      await runTimelogReminder(sql);
    } else {
      return res.status(400).json({ error: `Unknown type: ${type}` });
    }

    return res.status(200).json({ ok: true, type, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error(`[cron/notify] Error (${type}):`, err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function alreadyNotified(sql, type, refId, channel) {
  const rows = await sql`
    SELECT id FROM notification_log
    WHERE type = ${type} AND ref_id = ${refId} AND channel = ${channel}
      AND sent_date = CURRENT_DATE
    LIMIT 1
  `;
  return rows.length > 0;
}

async function logNotification(sql, type, refId, channel) {
  await sql`
    INSERT INTO notification_log (type, ref_id, channel, sent_date)
    VALUES (${type}, ${refId}, ${channel}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;
}

// ─────────────────────────────────────────────────────────────────────────────

async function runDueTicketAlerts(sql) {
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const tickets = await sql`
    SELECT i.id, i.redmine_id, i.title, i.due_date, i.priority, i.status,
           p.name AS project_name, u.name AS assigned_name,
           u.email AS assigned_email, u.telegram_chat_id
    FROM issues i
    LEFT JOIN users    u ON u.id = i.assigned_to_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.due_date IN (${today}, ${tomorrow})
      AND i.status NOT IN ('Closed', 'Resolved')
      AND u.id IS NOT NULL
  `;

  for (const t of tickets) {
    const dueLabel = t.due_date === today ? '🔴 TODAY' : '🟡 TOMORROW';
    const msg = `${dueLabel} — Ticket Due Reminder\n\n` +
      `*[TK-${t.redmine_id}]* ${t.title}\n📁 ${t.project_name}\n🏷 ${t.priority} | ${t.status}\n📅 Due: ${t.due_date}`;

    if (t.telegram_chat_id && !(await alreadyNotified(sql, 'due_ticket', t.id, 'telegram'))) {
      await sendTelegramMessage(t.telegram_chat_id, msg);
      await logNotification(sql, 'due_ticket', t.id, 'telegram');
    }

    if (t.assigned_email && !(await alreadyNotified(sql, 'due_ticket', t.id, 'email'))) {
      const subject = `[${t.due_date === today ? 'DUE TODAY' : 'DUE TOMORROW'}] ${t.title}`;
      const html = `<div style="font-family:sans-serif"><h3>⏰ ${subject}</h3>
        <p><b>Project:</b> ${t.project_name}</p><p><b>Priority:</b> ${t.priority} | <b>Status:</b> ${t.status}</p>
        <p>Please update the ticket status on Redmine.</p></div>`;
      await sendEmail(t.assigned_email, subject, html);
      await logNotification(sql, 'due_ticket', t.id, 'email');
    }
  }

  console.log(`[cron] due_ticket alerts sent for ${tickets.length} ticket(s)`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function runTimelogReminder(sql) {
  // Skip weekends
  const day = new Date().getDay();
  if (day === 0 || day === 6) return;

  const today = new Date().toISOString().split('T')[0];
  const users = await sql`
    SELECT dts.id, dts.name, u.email, u.telegram_chat_id
    FROM daily_time_status dts
    JOIN users u ON u.id = dts.id
    WHERE dts.logged_today = false AND u.active = true
  `;

  for (const u of users) {
    const msg = `⏰ *Time-Log Reminder*\n\nHi ${u.name.split(' ')[0]}! You haven't logged any time today (${today}).\nPlease update Redmine before 8:00 PM 🙏`;

    if (u.telegram_chat_id && !(await alreadyNotified(sql, 'timelog_reminder', u.id, 'telegram'))) {
      await sendTelegramMessage(u.telegram_chat_id, msg);
      await logNotification(sql, 'timelog_reminder', u.id, 'telegram');
    }

    if (u.email && !(await alreadyNotified(sql, 'timelog_reminder', u.id, 'email'))) {
      await sendEmail(u.email, `⏰ Reminder: Log your time for ${today}`,
        `<div style="font-family:sans-serif"><h3>⏰ Time-Log Reminder</h3>
        <p>Hi <b>${u.name}</b>,</p><p>You haven't logged time in Redmine today (<b>${today}</b>).</p>
        <p>Please update before <b>8:00 PM</b>.</p>
        <a href="${process.env.REDMINE_URL || ''}/my/page" style="background:#f59e0b;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none">Log Time →</a></div>`);
      await logNotification(sql, 'timelog_reminder', u.id, 'email');
    }
  }

  console.log(`[cron] timelog_reminder sent for ${users.length} user(s)`);
}
