import { requireAdmin } from '../../../lib/admin'
import { getDb } from '../../../lib/db'
import { send500 } from '../../../lib/api-error'

export default async function handler(req, res) {
  const sql = getDb()

  try {
    const user = await requireAdmin(req, res)
    if (!user) return

    if (req.method === 'GET') {
      const projects = await sql`
        SELECT p.id, p.name, p.status, p.manager_id, u.name as manager_name, u.initials as manager_initials
        FROM projects p
        LEFT JOIN users u ON p.manager_id = u.id
        WHERE p.status = 'active'
        ORDER BY p.name
      `
      return res.status(200).json({ projects })
    }

    if (req.method === 'PUT') {
      const { id, manager_id } = req.body
      if (!id) return res.status(400).json({ error: 'Project ID is required' })

      const result = await sql`
        UPDATE projects 
        SET 
          manager_id = ${manager_id || null},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, name, manager_id
      `

      return res.status(200).json({ project: result[0] })
    }

    res.status(405).end()
  } catch (err) {
    console.error(err)
    send500(res, err, 'admin-projects')
  }
}
