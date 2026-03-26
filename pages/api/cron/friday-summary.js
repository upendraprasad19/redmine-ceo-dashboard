/**
 * pages/api/cron/friday-summary.js
 * Sends weekly org summary to all managers every Friday.
 * Cron: 13:30 UTC Friday = 7:00 PM IST
 */

import { getDb } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const sql = getDb();
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  try {
    const managers = await sql`
      SELECT id, display_name, telegram_id
      FROM dashboard_users
      WHERE active = true AND role = 'manager' AND telegram_id IS NOT NULL
    `;

    const [velocity, compliance, overdue, topProjects] = await Promise.all([
      sql`SELECT COUNT(*) AS count FROM issues WHERE status IN ('Closed','Resolved') AND updated_at >= NOW() - INTERVAL '7 days'`,
      sql`
        SELECT ROUND(COUNT(DISTINCT te.user_id) * 100.0 / NULLIF((SELECT COUNT(*) FROM users WHERE active = true), 0)) AS pct
        FROM time_entries te WHERE te.spent_on >= CURRENT_DATE - 7
      `,
      sql`SELECT COUNT(*) AS count FROM issues WHERE due_date < CURRENT_DATE AND status NOT IN ('Closed','Resolved','Verified','Rejected')`,
      sql`
        SELECT p.name,
          (SELECT COUNT(*) FROM issues WHERE project_id = p.id AND status NOT IN ('Closed','Resolved','Verified','Rejected')) AS open_tickets
        FROM projects p WHERE p.status = 'active' ORDER BY open_tickets DESC LIMIT 5
      `,
    ]);

    const closed = parseInt(velocity[0]?.count || 0);
    const pct = parseInt(compliance[0]?.pct || 0);
    const overdueCount = parseInt(overdue[0]?.count || 0);

    const dateStr = new Date().toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long',
    });

    const lines = [
      `📊 *Weekly Summary — ${dateStr}*\n`,
      `✅ Tickets closed this week: *${closed}*`,
      `⏰ Time log compliance: *${pct}%*`,
      `🔴 Currently overdue: *${overdueCount}*\n`,
      `*Top Projects by Open Tickets:*`,
      ...topProjects.map(p => `  • ${p.name}: *${p.open_tickets}* open`),
      `\nHave a great weekend! 🎉`,
    ];

    const msg = lines.join('\n');
    let sent = 0;
    for (const m of managers) {
      try {
        await sendTelegramMessage(TELEGRAM_TOKEN, m.telegram_id, msg);
        sent++;
      } catch (e) {
        console.error(`Friday summary failed for ${m.display_name}:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('Friday summary error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function sendTelegramMessage(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description);
}
