import { serialize } from 'cookie';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  // Check password against env var
  if (password !== process.env.DASHBOARD_PASSWORD) {
    // Small delay to prevent brute force
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Set session cookie — httpOnly, secure, 8 hour expiry
  const cookie = serialize('ceo_session', process.env.SESSION_SECRET, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/',
  });

  res.setHeader('Set-Cookie', cookie);
  res.status(200).json({ ok: true });
}
