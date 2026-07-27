const { getCurrentUser } = require('./auth')
const { checkAccess } = require('./roles')

async function requireAdmin(req, res) {
  const user = await getCurrentUser(req)
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' })
    return null
  }

  if (!checkAccess(user, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions' })
    return null
  }

  return user
}

module.exports = { requireAdmin }
