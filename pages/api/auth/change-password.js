const { getDb } = require('../../../lib/db');
const { getCurrentUser, hashPassword, verifyPassword } = require('../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Both oldPassword and newPassword are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const sql = getDb();
  const rows = await sql`SELECT password_hash FROM dashboard_users WHERE id = ${user.id} LIMIT 1`;
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

  const ok = await verifyPassword(oldPassword, rows[0].password_hash);
  if (!ok) return res.status(403).json({ error: 'Current password is incorrect' });

  const newHash = await hashPassword(newPassword);
  await sql`UPDATE dashboard_users SET password_hash = ${newHash}, updated_at = NOW() WHERE id = ${user.id}`;

  return res.status(200).json({ ok: true });
}
