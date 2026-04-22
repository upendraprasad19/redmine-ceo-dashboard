const { getCurrentUser } = require('../../../lib/auth');
const { getDb } = require('../../../lib/db');
const { checkAccess } = require('../../../lib/roles');

const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected', 'resolved', 'all']);

export default async function handler(req, res) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!checkAccess(user, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (req.method !== 'GET') return res.status(405).end();

    const statusRaw = (req.query.status || 'pending').toString();
    if (!ALLOWED_STATUSES.has(statusRaw)) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'Invalid status filter' });
    }

    const sql = getDb();
    const requests = await sql`
      SELECT ar.id, ar.full_name, ar.email, ar.team, ar.message, ar.status,
             ar.created_at, ar.reviewed_at,
             rb.display_name AS reviewed_by_name
      FROM access_requests ar
      LEFT JOIN dashboard_users rb ON rb.id = ar.reviewed_by
      WHERE (${statusRaw} = 'all' OR ar.status = ${statusRaw})
      ORDER BY ar.created_at DESC
      LIMIT 200
    `;

    return res.status(200).json({ requests });
  } catch (err) {
    console.error('Access-requests list error:', err);
    return res.status(500).json({ error: err.message });
  }
}
