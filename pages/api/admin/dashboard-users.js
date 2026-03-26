const { getCurrentUser, hashPassword } = require('../../../lib/auth');
const { getDb } = require('../../../lib/db');
const { checkAccess } = require('../../../lib/roles');

export default async function handler(req, res) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!checkAccess(user, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const sql = getDb();

    // GET — list all dashboard users
    if (req.method === 'GET') {
      const users = await sql`
        SELECT du.id, du.username, du.display_name, du.role, du.team, du.telegram_id, du.active, du.created_at,
               u.email, u.name AS redmine_name
        FROM dashboard_users du
        LEFT JOIN users u ON u.id = du.linked_redmine_user_id
        ORDER BY du.display_name ASC
      `;
      return res.status(200).json({ users });
    }

    // POST — create new dashboard user
    if (req.method === 'POST') {
      const { username, password, display_name, role, team, telegram_id, linked_redmine_user_id } = req.body;

      if (!username || !password || !display_name) {
        return res.status(400).json({ error: 'username, password, and display_name are required' });
      }

      // Check if username already exists
      const existing = await sql`
        SELECT id FROM dashboard_users WHERE username = ${username} LIMIT 1
      `;
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      const password_hash = await hashPassword(password);

      const result = await sql`
        INSERT INTO dashboard_users (username, password_hash, display_name, role, team, telegram_id, linked_redmine_user_id, active, created_at)
        VALUES (${username}, ${password_hash}, ${display_name}, ${role || 'team_lead'}, ${team || null}, ${telegram_id || null}, ${linked_redmine_user_id || null}, true, NOW())
        RETURNING id, username, display_name, role, team, telegram_id, active
      `;

      return res.status(201).json({ user: result[0] });
    }

    // PUT — update existing dashboard user
    if (req.method === 'PUT') {
      const { id, role, team, active, telegram_id, display_name } = req.body;

      if (!id) return res.status(400).json({ error: 'User id is required' });

      await sql`
        UPDATE dashboard_users
        SET
          role = COALESCE(${role || null}, role),
          team = COALESCE(${team || null}, team),
          active = COALESCE(${active !== undefined ? active : null}, active),
          telegram_id = COALESCE(${telegram_id || null}, telegram_id),
          display_name = COALESCE(${display_name || null}, display_name)
        WHERE id = ${id}
      `;

      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('Dashboard users admin error:', err);
    res.status(500).json({ error: err.message });
  }
}
