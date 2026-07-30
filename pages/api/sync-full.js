/**
 * Full Redmine sync — runs every Saturday via Vercel Cron.
 * Backfills the last 6 months regardless of last_synced_at.
 * GET /api/sync-full  (Vercel Cron sends Authorization: Bearer <CRON_SECRET>)
 */
const { send500 } = require('../../lib/api-error')

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(501).json({ error: 'CRON_SECRET not configured' })
  }
  const bearer = (req.headers.authorization || '').replace('Bearer ', '')
  if (bearer !== cronSecret) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { spawn } = await import('node:child_process')
    const child = spawn('node', ['scripts/sync-redmine.js', '--full'], {
      stdio: 'inherit',
      detached: false,
    })
    child.on('error', (err) => console.error('[FullSync] spawn error:', err.message))
    child.on('exit', (code) => console.log(`[FullSync] finished with code ${code}`))
    res.status(200).json({ ok: true, message: 'Full sync started in background' })
  } catch (err) {
    return send500(res, err, 'sync-full')
  }
}
