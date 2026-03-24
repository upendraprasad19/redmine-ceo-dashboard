/**
 * pages/api/sync.js
 *
 * Sync trigger — called by:
 *   1. Vercel Cron  (GET, daily at 1AM UTC)  → full sync
 *   2. cron-job.org (POST, every 10 min)      → delta sync
 *   3. Dashboard "Sync Now" button (POST)     → full or delta
 *
 * Security: all callers must send the correct secret.
 *   Vercel Cron  → sets CRON_SECRET env var, sent as Authorization: Bearer <secret>
 *   cron-job.org → sends header:  x-sync-secret: <SYNC_SECRET>
 *   Dashboard    → sends header:  x-sync-secret: <SYNC_SECRET>
 */

import { neon } from '@neondatabase/serverless';
import { runSync } from '../../lib/sync-engine.js';

export const config = {
  maxDuration: 300, // 5 min — Vercel Pro allows up to 300s for cron functions
};

function isAuthorized(req) {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET; // Vercel auto-sets this for cron jobs

  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers['authorization'] || '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  // cron-job.org / dashboard sends: x-sync-secret: <SYNC_SECRET>
  if (syncSecret && req.headers['x-sync-secret'] === syncSecret) return true;

  return false;
}

export default async function handler(req, res) {
  // Accept both GET (Vercel Cron) and POST (cron-job.org / manual)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Determine mode:
  //   GET  (Vercel Cron)  → full
  //   POST with { mode: 'delta' } → delta
  //   POST with { mode: 'full' }  → full
  //   POST with no body           → delta (default for frequent external cron)
  let mode = 'full';
  if (req.method === 'POST') {
    mode = req.body?.mode === 'full' ? 'full' : 'delta';
  }

  const logs = [];
  const log  = msg => { logs.push(msg); console.log(msg); };

  try {
    const sql    = neon(process.env.DATABASE_URL);
    const result = await runSync(mode, sql, log);

    return res.status(200).json({
      ok: true,
      mode,
      elapsed: result.elapsed,
      results: result.results,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({
      ok: false,
      mode,
      error: err.message,
      logs,
    });
  }
}
