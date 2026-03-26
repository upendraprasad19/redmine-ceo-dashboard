const { getCurrentUser } = require('../../lib/auth');
const { getDb } = require('../../lib/db');

export default async function handler(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const sql = getDb();

  if (req.method === 'GET') {
    try {
      const insights = await sql`
        SELECT id, insight_type, title, body, severity, created_at
        FROM pinned_insights
        WHERE user_id = ${user.id} AND dismissed = false
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END,
          created_at DESC
      `;
      return res.status(200).json({ insights });
    } catch (err) {
      console.error('Insights GET error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    // Dismiss an insight
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Insight id required' });

      await sql`
        UPDATE pinned_insights
        SET dismissed = true
        WHERE id = ${id} AND user_id = ${user.id}
      `;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Insights POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
