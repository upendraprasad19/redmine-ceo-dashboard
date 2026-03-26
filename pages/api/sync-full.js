/**
 * Full Redmine sync — runs every Saturday via Vercel Cron.
 * Backfills the last 6 months regardless of last_synced_at.
 * GET /api/sync-full  (Vercel Cron sends Authorization: Bearer <CRON_SECRET>)
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    if (bearer !== cronSecret) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { spawn } = await import('child_process');
    const child = spawn('node', ['scripts/sync-redmine.js', '--full'], {
      stdio: 'inherit',
      detached: false,
    });
    child.on('error', (err) => console.error('[FullSync] spawn error:', err.message));
    child.on('exit', (code) => console.log(`[FullSync] finished with code ${code}`));
    res.status(200).json({ ok: true, message: 'Full sync started in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
