const jwt = require('jsonwebtoken');
const { getDb } = require('../../../../lib/db');
const { hashPassword } = require('../../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'resetToken and newPassword required' });
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  let payload;
  try {
    payload = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid or expired reset token' });
  }
  if (payload.purpose !== 'password_reset' || !payload.userId) {
    return res.status(401).json({ error: 'invalid reset token' });
  }

  const sql = getDb();

  // Confirm the referenced token still exists & unused — prevents replay.
  const tok = await sql`
    SELECT id FROM password_reset_tokens
    WHERE id = ${payload.tokenId} AND user_id = ${payload.userId} AND used_at IS NULL
    LIMIT 1
  `;
  if (tok.length === 0) return res.status(401).json({ error: 'reset token already used or revoked' });

  const newHash = await hashPassword(newPassword);
  await sql`UPDATE dashboard_users SET password_hash = ${newHash}, updated_at = NOW() WHERE id = ${payload.userId}`;
  // Invalidate this token + any other outstanding for the user
  await sql`UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ${payload.userId} AND used_at IS NULL`;

  return res.status(200).json({ ok: true });
}
