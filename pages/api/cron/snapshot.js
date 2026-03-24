/**
 * pages/api/cron/snapshot.js
 *
 * Vercel Cron / manual trigger to take a daily team snapshot.
 * Schedule: "0 20 * * 1-5" (8 PM UTC ≈ IST midnight, Mon–Fri)
 *
 * Auth: Authorization: Bearer <CRON_SECRET>  OR  x-sync-secret: <SYNC_SECRET>
 */

import { neon } from '@neondatabase/serverless';
import { takeSnapshot } from '../../../scripts/snapshot-runner.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate auth — accept either Vercel cron bearer token or legacy sync secret
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const syncSecret = req.headers['x-sync-secret'];

  const validBearer = process.env.CRON_SECRET && bearerToken === process.env.CRON_SECRET;
  const validSync   = process.env.SYNC_SECRET  && syncSecret  === process.env.SYNC_SECRET;

  if (!validBearer && !validSync) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const result = await takeSnapshot(sql);

    return res.status(200).json({
      ok: true,
      teams: result.teams,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cron/snapshot] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
