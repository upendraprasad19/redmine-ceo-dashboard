const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../../../../lib/db');

const MAX_ATTEMPTS = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { username, code } = req.body || {};
  if (!username || !code) return res.status(400).json({ error: 'username and code required' });

  const sql = getDb();
  const userRows = await sql`SELECT id FROM dashboard_users WHERE username = ${username} AND active = true LIMIT 1`;
  const userId = userRows[0]?.id;
  if (!userId) return res.status(400).json({ error: 'invalid or expired code' });

  // Newest unused token for this user
  const tokRows = await sql`
    SELECT id, code_hash, expires_at, attempts
    FROM password_reset_tokens
    WHERE user_id = ${userId} AND used_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `;
  const tok = tokRows[0];
  if (!tok) return res.status(400).json({ error: 'invalid or expired code' });

  if (new Date(tok.expires_at) < new Date()) {
    return res.status(400).json({ error: 'invalid or expired code' });
  }
  if (tok.attempts >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'too many attempts — request a new code' });
  }

  const match = await bcrypt.compare(String(code), tok.code_hash);
  if (!match) {
    await sql`UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = ${tok.id}`;
    return res.status(400).json({ error: 'invalid or expired code' });
  }

  // Short-lived reset token (15 min) — user passes this to /reset to set new password.
  const resetToken = jwt.sign(
    { purpose: 'password_reset', userId, tokenId: tok.id },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  return res.status(200).json({ resetToken });
}
