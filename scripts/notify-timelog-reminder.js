/**
 * scripts/notify-timelog-reminder.js
 *
 * Sends Telegram + Email reminders to developers who haven't
 * logged any time today. Runs weekdays at 7:30 PM IST.
 *
 * Usage:  node scripts/notify-timelog-reminder.js
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { sendTelegramMessage } from '../lib/telegram.js';
import { sendEmail } from '../lib/mailer.js';

const sql = neon(process.env.DATABASE_URL);

async function alreadyNotified(userId) {
  const rows = await sql`
    SELECT id FROM notification_log
    WHERE type = 'timelog_reminder'
      AND ref_id = ${userId}
      AND channel = 'telegram'
      AND sent_date = CURRENT_DATE
    LIMIT 1
  `;
  return rows.length > 0;
}

async function logNotification(userId, channel) {
  await sql`
    INSERT INTO notification_log (type, ref_id, channel, sent_date)
    VALUES ('timelog_reminder', ${userId}, ${channel}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;
}

async function run() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n⏰ Time-log reminder — ${today}`);

  // Skip weekends
  const dayOfWeek = new Date().getDay(); // 0=Sun, 6=Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log('  📅 Weekend — skipping.');
    return;
  }

  // Use daily_time_status view (already in schema)
  const users = await sql`
    SELECT
      dts.id,
      dts.name,
      dts.team,
      dts.hours_today,
      dts.logged_today,
      u.email,
      u.telegram_chat_id
    FROM daily_time_status dts
    JOIN users u ON u.id = dts.id
    WHERE dts.logged_today = false
      AND u.active = true
    ORDER BY dts.team, dts.name
  `;

  console.log(`  Found ${users.length} developer(s) who haven't logged time today\n`);

  for (const u of users) {
    if (await alreadyNotified(u.id)) {
      console.log(`  ⏩ Already notified ${u.name} today`);
      continue;
    }

    const msg =
      `⏰ *Time-Log Reminder*\n\n` +
      `Hi ${u.name.split(' ')[0]}! You haven't logged any time in Redmine today.\n\n` +
      `📅 Date: ${today}\n` +
      `🏷 Team: ${u.team || 'N/A'}\n\n` +
      `Please update your time log on Redmine before 8:00 PM. Thanks! 🙏`;

    // ── Telegram ──────────────────────────────────────────────
    if (u.telegram_chat_id) {
      await sendTelegramMessage(u.telegram_chat_id, msg);
      await logNotification(u.id, 'telegram');
      console.log(`  📱 Telegram → ${u.name}`);
    } else {
      console.log(`  ⚠️  No Telegram registered for ${u.name}`);
    }

    // ── Email ─────────────────────────────────────────────────
    if (u.email) {
      const subject = `⏰ Reminder: Please log your time for ${today}`;
      const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:auto">
          <div style="background:#f59e0b;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0">
            <h2 style="margin:0">⏰ Time-Log Reminder</h2>
          </div>
          <div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 8px 8px">
            <p>Hi <strong>${u.name.split(' ')[0]}</strong>,</p>
            <p>You haven't logged any time in Redmine today (<strong>${today}</strong>).</p>
            <p>Please update your time log before <strong>8:00 PM</strong> so the project manager has an accurate view of progress.</p>
            <a href="${process.env.REDMINE_URL || 'https://redmine.thinkingcode.com'}/my/page"
               style="display:inline-block;margin-top:12px;background:#f59e0b;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">
              Log Time on Redmine →
            </a>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
            <p style="color:#9ca3af;font-size:12px">Team: ${u.team || 'N/A'}</p>
          </div>
        </div>`;
      await sendEmail(u.email, subject, html);
      await logNotification(u.id, 'email');
      console.log(`  📧 Email → ${u.email}`);
    }
  }

  console.log('\n✅ Time-log reminder done!');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
