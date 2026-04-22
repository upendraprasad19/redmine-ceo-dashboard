/**
 * pages/api/cron/missing-log-reminder.js
 * Reminds users who haven't logged time by 5 PM IST.
 * Cron: 11:30 UTC Mon-Fri = 5:00 PM IST weekdays
 */

import { getDb } from '../../../lib/db';
import { sendTelegramMessage } from '../../../lib/telegram';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  // Skip weekends
  const day = new Date().getDay();
  if (day === 0 || day === 6) return res.status(200).json({ ok: true, skipped: 'weekend' });

  const sql = getDb();
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  try {
    // Find dashboard users who have a linked Redmine user that hasn't logged time today
    const missing = await sql`
      SELECT du.id, du.display_name, du.telegram_id
      FROM dashboard_users du
      JOIN users u ON u.id = du.linked_redmine_user_id
      WHERE du.active = true
        AND du.telegram_id IS NOT NULL
        AND u.active = true
        AND NOT EXISTS (
          SELECT 1 FROM time_entries te
          WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE
        )
    `;

    let sent = 0;
    for (const user of missing) {
      const msg = `⏰ *Time Log Reminder*\n\nHey ${user.display_name}! You haven't logged your time yet today.\n\nDon't forget before EOD 📝`;
      try {
        await sendTelegramMessage(user.telegram_id, msg);
        sent++;
      } catch (e) {
        console.error(`Reminder failed for ${user.display_name}:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, sent, total: missing.length });
  } catch (err) {
    console.error('Missing log reminder error:', err);
    return res.status(500).json({ error: err.message });
  }
}

