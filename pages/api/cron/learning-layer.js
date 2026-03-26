/**
 * pages/api/cron/learning-layer.js
 * Weekly: analyzes chat_history to learn each user's interests.
 * Auto-updates top_concerns based on what they ask about most.
 * Cron: 20:30 UTC Sunday = 2:00 AM IST Monday
 */

import { getDb } from '../../../lib/db';

const TOPIC_PATTERNS = [
  { topic: 'overdue_tickets',   patterns: ['overdue', 'late', 'past due', 'missed deadline'] },
  { topic: 'missing_time_logs', patterns: ['time log', 'time entry', 'logged time', 'missing log', 'hours'] },
  { topic: 'blocked_tickets',   patterns: ['blocked', 'blocker', 'stuck'] },
  { topic: 'project_risks',     patterns: ['project', 'risk', 'deadline', 'milestone'] },
  { topic: 'team_health',       patterns: ['team health', 'morale', 'wellness', 'burnout'] },
  { topic: 'capacity',          patterns: ['capacity', 'workload', 'bandwidth', 'overloaded'] },
];

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const sql = getDb();

  try {
    const recentChats = await sql`
      SELECT user_id, content
      FROM chat_history
      WHERE role = 'user' AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY user_id, created_at
    `;

    // Group messages by user
    const byUser = {};
    for (const row of recentChats) {
      if (!byUser[row.user_id]) byUser[row.user_id] = [];
      byUser[row.user_id].push(row.content.toLowerCase());
    }

    let updated = 0;
    for (const [userId, messages] of Object.entries(byUser)) {
      const combined = messages.join(' ');
      const topicCounts = {};

      for (const { topic, patterns } of TOPIC_PATTERNS) {
        let count = 0;
        for (const p of patterns) {
          count += (combined.match(new RegExp(p, 'gi')) || []).length;
        }
        if (count >= 2) topicCounts[topic] = count;
      }

      if (Object.keys(topicCounts).length === 0) continue;

      const newConcerns = Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);

      const existing = await sql`SELECT top_concerns FROM dashboard_users WHERE id = ${userId}`;
      const current = existing[0]?.top_concerns || [];
      const merged = [...new Set([...current, ...newConcerns])].slice(0, 5);

      await sql`UPDATE dashboard_users SET top_concerns = ${merged}, updated_at = NOW() WHERE id = ${userId}`;
      updated++;
    }

    return res.status(200).json({ ok: true, users_analyzed: Object.keys(byUser).length, updated });
  } catch (err) {
    console.error('Learning layer error:', err);
    return res.status(500).json({ error: err.message });
  }
}
