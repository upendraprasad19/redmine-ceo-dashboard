const { getCurrentUser } = require('../../lib/auth')
const { getDb } = require('../../lib/db')
const { send500 } = require('../../lib/api-error')

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const sql = getDb()
    const page = parseInt(req.query.page, 10) || 1
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100)
    const offset = (page - 1) * limit

    const messages = await sql`
      SELECT id, role, content, metadata, created_at
      FROM chat_history
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    // Get total count for pagination
    const countResult = await sql`
      SELECT COUNT(*) AS total FROM chat_history WHERE user_id = ${user.id}
    `
    const total = parseInt(countResult[0]?.total || 0, 10)

    res.status(200).json({
      messages: messages.reverse(), // Return oldest first within page
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    console.error('Chat history error:', err)
    send500(res, err, 'chat-history')
  }
}
