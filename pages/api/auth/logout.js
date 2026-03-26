const { clearAuthCookie } = require('../../../lib/auth');

export default function handler(req, res) {
  clearAuthCookie(res);
  res.redirect(307, '/login');
}
