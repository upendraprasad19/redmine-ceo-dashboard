const { clearAuthCookie } = require('../../../lib/auth')

export default function handler(_req, res) {
  clearAuthCookie(res)
  res.redirect(307, '/login')
}
