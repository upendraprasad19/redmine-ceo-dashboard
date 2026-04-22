/**
 * pages/api/cron/reminder-delivery.js
 * Checks for pending user reminders and delivers them via Telegram.
 * Cron: every 15 minutes
 */

import { getDb } from '../../../lib/db';
import { sendTelegramMessage } from '../../../lib/telegram';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const sql = getDb();
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  try {
    const due = await sql`
      SELECT id, telegram_id, message, remind_at
      FROM user_reminders
      WHERE sent = false AND remind_at <= NOW()
      ORDER BY remind_at ASC
      LIMIT 50
    `;

    let sent = 0;
    for (const reminder of due) {
      try {
        await sendTelegramMessage(reminder.telegram_id, `⏰ *Reminder*\n\n${reminder.message}`);
        await sql`UPDATE user_reminders SET sent = true WHERE id = ${reminder.id}`;
        sent++;
      } catch (e) {
        console.error(`Reminder ${reminder.id} failed:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, sent, total: due.length });
  } catch (err) {
    console.error('Reminder delivery error:', err);
    return res.status(500).json({ error: err.message });
  }
}

