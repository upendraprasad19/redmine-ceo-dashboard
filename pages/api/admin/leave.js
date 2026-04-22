import { getDb } from '../../../lib/db';
import { requireAdmin } from '../../../lib/admin';

export default async function handler(req, res) {
  const sql = getDb();

  try {
    const user = await requireAdmin(req, res);
    if (!user) return;

    if (req.method === 'GET') {
      const records = await sql`
        SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date, lr.notes, lr.source, u.name as user_name
        FROM leave_records lr
        JOIN users u ON lr.user_id = u.id
        WHERE lr.end_date >= CURRENT_DATE
        ORDER BY lr.start_date DESC
      `;
      return res.status(200).json({ records });
    }

    if (req.method === 'POST') {
      const { user_id, leave_type, start_date, end_date, notes } = req.body;
      const result = await sql`
        INSERT INTO leave_records (user_id, leave_type, start_date, end_date, notes, source)
        VALUES (${user_id}, ${leave_type || 'Other'}, ${start_date}, ${end_date}, ${notes || null}, 'manual')
        RETURNING id
      `;
      return res.status(200).json({ id: result[0].id });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      await sql`DELETE FROM leave_records WHERE id = ${id} AND source = 'manual'`;
      return res.status(200).json({ success: true });
    }

    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
