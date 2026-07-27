/**
 * pages/api/admin/unknown-queries.js
 * GET:   list all unknown bot queries for the User Demands admin tab
 * PATCH: update status of a query (unreviewed → planned / building / done)
 */

const { getCurrentUser } = require('../../../lib/auth')
const { getDb } = require('../../../lib/db')
const { checkAccess } = require('../../../lib/roles')
const { send500 } = require('../../../lib/api-error')

export default async function handler(req, res) {
  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })
    if (!checkAccess(user, 'admin'))
      return res.status(403).json({ error: 'Insufficient permissions' })

    const sql = getDb()

    if (req.method === 'GET') {
      const queries = await sql`
        SELECT
          q.id, q.query_text, q.user_role, q.user_team,
          q.suggested_alternative, q.frequency, q.status,
          q.created_at, q.updated_at,
          du.display_name AS asked_by
        FROM bot_unknown_queries q
        LEFT JOIN dashboard_users du ON du.id = q.user_id
        ORDER BY q.frequency DESC, q.created_at DESC
      `
      return res.status(200).json({ queries })
    }

    if (req.method === 'PATCH') {
      const { id, status } = req.body
      if (!id || !status) return res.status(400).json({ error: 'id and status required' })
      const valid = ['unreviewed', 'planned', 'building', 'done']
      if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' })

      await sql`UPDATE bot_unknown_queries SET status = ${status}, updated_at = NOW() WHERE id = ${id}`
      return res.status(200).json({ ok: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('Unknown queries error:', err)
    return send500(res, err, 'unknown-queries')
  }
}
