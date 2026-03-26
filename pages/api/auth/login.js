const { getDb } = require('../../../lib/db');
const { verifyPassword, createToken, setAuthCookie } = require('../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const sql = getDb();

    const rows = await sql`
      SELECT id, username, password_hash, display_name, role, team, linked_redmine_user_id, telegram_id, active
      FROM dashboard_users
      WHERE username = ${username} AND active = true
      LIMIT 1
    `;

    if (rows.length === 0) {
      // Delay to prevent brute force timing attacks
      await new Promise(r => setTimeout(r, 800));
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.password_hash);

    if (!valid) {
      await new Promise(r => setTimeout(r, 800));
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Create JWT and set cookie
    const token = createToken({
      id: user.id,
      username: user.username,
      role: user.role,
      team: user.team,
      display_name: user.display_name,
    });

    setAuthCookie(res, token);
    res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        team: user.team,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
