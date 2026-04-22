/**
 * pages/api/cron/morning-briefing.js
 * Sends personalized morning briefing to all active users with briefing enabled.
 * Cron: 03:30 UTC daily = 9:00 AM IST
 * Protected by CRON_SECRET header.
 */

import { getDb } from '../../../lib/db';
import { sendTelegramMessage } from '../../../lib/telegram';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getDb();
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not set' });

  try {
    const users = await sql`
      SELECT id, display_name, username, role, team, telegram_id,
             behavior_profile, top_concerns, morning_briefing
      FROM dashboard_users
      WHERE active = true
        AND telegram_id IS NOT NULL
        AND (
          behavior_profile->>'morning_briefing' IN ('daily', 'weekdays')
          OR morning_briefing IN ('daily', 'weekdays')
        )
    `;

    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const user of users) {
      try {
        const profile = typeof user.behavior_profile === 'string'
          ? JSON.parse(user.behavior_profile || '{}')
          : (user.behavior_profile || {});

        const briefingPref = user.morning_briefing || profile.morning_briefing;
        if (briefingPref === 'weekdays' && isWeekend) {
          skipped++;
          continue;
        }

        const briefingText = await buildBriefing(sql, user, profile);
        await sendTelegramMessage(user.telegram_id, briefingText);
        sent++;
      } catch (err) {
        errors.push({ user: user.username, error: err.message });
      }
    }

    return res.status(200).json({ ok: true, sent, skipped, errors });
  } catch (err) {
    console.error('Morning briefing cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function buildBriefing(sql, user, profile) {
  const isManager = user.role === 'manager';
  const team = user.team;
  const concerns = Array.isArray(user.top_concerns) ? user.top_concerns : [];
  const name = user.display_name || user.username;

  const todayStr = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long',
  });

  const [overdueRes, missingRes, blockedRes, leaveRes] = await Promise.all([
    isManager
      ? sql`SELECT COUNT(*) AS count FROM issues WHERE due_date < CURRENT_DATE AND status NOT IN ('Closed','Resolved','Verified','Rejected')`
      : sql`SELECT COUNT(*) AS count FROM issues i JOIN users u ON u.id = i.assigned_to_id WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved','Verified','Rejected') AND u.team = ${team}`,
    isManager
      ? sql`SELECT COUNT(*) AS count FROM users WHERE active = true AND NOT EXISTS (SELECT 1 FROM time_entries WHERE user_id = users.id AND spent_on = CURRENT_DATE)`
      : sql`SELECT COUNT(*) AS count FROM users WHERE active = true AND team = ${team} AND NOT EXISTS (SELECT 1 FROM time_entries WHERE user_id = users.id AND spent_on = CURRENT_DATE)`,
    isManager
      ? sql`SELECT COUNT(*) AS count FROM issues WHERE status = 'Blocked'`
      : sql`SELECT COUNT(*) AS count FROM issues i JOIN users u ON u.id = i.assigned_to_id WHERE i.status = 'Blocked' AND u.team = ${team}`,
    isManager
      ? sql`SELECT COUNT(*) AS count FROM leave_records WHERE CURRENT_DATE BETWEEN start_date AND end_date`
      : sql`SELECT COUNT(*) AS count FROM leave_records lr JOIN users u ON u.id = lr.user_id WHERE CURRENT_DATE BETWEEN lr.start_date AND lr.end_date AND u.team = ${team}`,
  ]);

  const overdue = parseInt(overdueRes[0]?.count || 0);
  const missing = parseInt(missingRes[0]?.count || 0);
  const blocked = parseInt(blockedRes[0]?.count || 0);
  const onLeave = parseInt(leaveRes[0]?.count || 0);
  const scope = isManager ? 'Organization' : `${team} Team`;

  const lines = [
    `☀️ *Good morning, ${name}!*`,
    `📅 ${todayStr}\n`,
    `📊 *${scope} Overview:*`,
    `${overdue > 0 ? '🔴' : '🟢'} Overdue: *${overdue}*`,
    `${missing > 0 ? '🟡' : '🟢'} No time log today: *${missing}*`,
    `${blocked > 0 ? '🔴' : '🟢'} Blocked: *${blocked}*`,
    `🏖️ On leave: *${onLeave}*`,
  ];

  // Concern-specific extra data
  if (concerns.includes('overdue_tickets') && overdue > 0) {
    const top = isManager
      ? await sql`SELECT i.redmine_id, i.title, u.name AS assignee FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved','Verified','Rejected') ORDER BY i.due_date ASC LIMIT 3`
      : await sql`SELECT i.redmine_id, i.title, u.name AS assignee FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved','Verified','Rejected') AND u.team = ${team} ORDER BY i.due_date ASC LIMIT 3`;
    if (top.length > 0) {
      lines.push(`\n🔴 *Top overdue:*`);
      for (const t of top) {
        lines.push(`  • [TK-${t.redmine_id}](https://redmine.thinkingcode.com/issues/${t.redmine_id}) — ${t.assignee || 'Unassigned'}`);
      }
    }
  }

  if (concerns.includes('missing_time_logs') && missing > 0) {
    const who = isManager
      ? await sql`SELECT name FROM users WHERE active = true AND NOT EXISTS (SELECT 1 FROM time_entries WHERE user_id = users.id AND spent_on = CURRENT_DATE) ORDER BY name LIMIT 5`
      : await sql`SELECT name FROM users WHERE active = true AND team = ${team} AND NOT EXISTS (SELECT 1 FROM time_entries WHERE user_id = users.id AND spent_on = CURRENT_DATE) LIMIT 5`;
    if (who.length > 0) {
      lines.push(`\n⏰ *No time log yet:* ${who.map(u => u.name).join(', ')}`);
    }
  }

  lines.push(`\nHave a productive day! 🚀`);
  return lines.join('\n');
}

