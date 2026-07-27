const { getCurrentUser } = require('../../../lib/auth')

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    res.status(200).json({
      id: user.id,
      username: user.username,
      role: user.role,
      team: user.team,
      display_name: user.display_name,
    })
  } catch (err) {
    console.error('Auth me error:', err)
    res.status(401).json({ error: 'Not authenticated' })
  }
}
