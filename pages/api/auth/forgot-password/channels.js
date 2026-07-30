const { getDb } = require('../../../../lib/db')
const { send500 } = require('../../../../lib/api-error')

// Returns which reset channels (telegram/email) are available for a username.
// Never leaks whether the user exists — always returns a shape, even for unknown
// usernames — to prevent username enumeration.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { username } = req.body || {}
    if (!username) return res.status(400).json({ error: 'username required' })

    const sql = getDb()
    const rows = await sql`
      SELECT telegram_id, email
      FROM dashboard_users
      WHERE username = ${username} AND active = true LIMIT 1
    `
    const u = rows[0]
    return res.status(200).json({
      telegramAvailable: !!u?.telegram_id,
      emailAvailable: !!u?.email,
    })
  } catch (err) {
    return send500(res, err, 'forgot-password-channels')
  }
}
