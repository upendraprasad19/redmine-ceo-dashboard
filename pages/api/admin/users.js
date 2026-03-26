import { getDb } from '../../../lib/db';

export default async function handler(req, res) {
  const sql = getDb();

  try {
    if (req.method === 'GET') {
      const users = await sql`
        SELECT id, name, email, team, role, is_team_lead, active
        FROM users
        WHERE active = true
        ORDER BY team NULLS LAST, name
      `;
      return res.status(200).json({ users });
    }

    if (req.method === 'PUT') {
      const { id, team, role, is_team_lead } = req.body;
      if (!id) return res.status(400).json({ error: 'User ID is required' });

      const result = await sql`
        UPDATE users 
        SET 
          team = ${team || null}, 
          role = ${role || null}, 
          is_team_lead = ${is_team_lead || false},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, name, team, role, is_team_lead
      `;

      return res.status(200).json({ user: result[0] });
    }

    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
