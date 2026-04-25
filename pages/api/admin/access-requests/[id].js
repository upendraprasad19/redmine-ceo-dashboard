const { getCurrentUser } = require('../../../../lib/auth');
const { getDb } = require('../../../../lib/db');
const { checkAccess } = require('../../../../lib/roles');
const { sendAccessRejected } = require('../../../../lib/email');

export default async function handler(req, res) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!checkAccess(user, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (req.method !== 'POST') return res.status(405).end();

    const id = parseInt(req.query.id, 10);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'Invalid id' });
    }

    const { action } = req.body || {};
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'action must be approve or reject' });
    }

    const sql = getDb();
    const rows = await sql`
      SELECT id, full_name, email, status FROM access_requests WHERE id = ${id} LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Access request not found' });
    }

    const row = rows[0];
    if (row.status !== 'pending') {
      return res.status(409).json({
        error: 'CONFLICT',
        message: `Request is already ${row.status}; cannot ${action}`,
      });
    }

    if (action === 'approve') {
      await sql`
        UPDATE access_requests
        SET status = 'approved', reviewed_by = ${user.id}, reviewed_at = NOW()
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, id, status: 'approved' });
    }

    // action === 'reject'
    await sql`
      UPDATE access_requests
      SET status = 'rejected', reviewed_by = ${user.id}, reviewed_at = NOW()
      WHERE id = ${id}
    `;

    try {
      await sendAccessRejected(row.email, row.full_name);
    } catch (emailErr) {
      console.error('access-rejected email failed:', emailErr);
      // swallow — DB state is authoritative, email is best-effort
    }

    return res.status(200).json({ ok: true, id, status: 'rejected' });
  } catch (err) {
    console.error('Access-requests action error:', err);
    return res.status(500).json({ error: err.message });
  }
}
