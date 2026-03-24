import { serialize } from 'cookie';

export default function handler(req, res) {
  // Clear the session cookie
  const cookie = serialize('ceo_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  res.setHeader('Set-Cookie', cookie);
  res.redirect(307, '/login');
}
