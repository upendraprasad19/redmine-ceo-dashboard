/**
 * Manual sync trigger — also called by Vercel Cron daily
 * POST /api/sync  (protect with a secret header in production)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Simple secret check (skip if SYNC_SECRET not configured — dev/local only)
  if (process.env.SYNC_SECRET && req.headers['x-sync-secret'] !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { spawn } = await import('child_process');
    const child = spawn('node', ['scripts/sync-redmine.js'], {
      stdio: 'inherit',
      detached: false,
    });
    child.on('error', (err) => console.error('[Sync] spawn error:', err.message));
    child.on('exit', (code) => console.log(`[Sync] finished with code ${code}`));
    // Return immediately — sync runs in background
    res.status(200).json({ ok: true, message: 'Sync started in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
