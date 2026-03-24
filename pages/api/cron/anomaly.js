/**
 * pages/api/cron/anomaly.js
 *
 * Vercel Cron / manual trigger to detect anomalies and send Telegram alerts.
 * Schedule: "30 2 * * 1-5" (2:30 AM UTC ≈ 8 AM IST, Mon–Fri)
 *
 * Auth: Authorization: Bearer <CRON_SECRET>  OR  x-sync-secret: <SYNC_SECRET>
 *
 * Telegram destination priority:
 *   1. TELEGRAM_CEO_CHAT_ID env var (single chat, e.g. CEO or ops channel)
 *   2. Broadcast to all users with is_team_lead = true
 */

import { neon } from '@neondatabase/serverless';
import { detectAnomalies } from '../../../lib/anomaly-detector.js';

export const config = { maxDuration: 60 };

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the sendTelegram function.
 * Severity 'critical' gets a prefix injected so leads can triage quickly.
 */
function buildSendTelegram(sql) {
  return async function sendTelegram(message, severity) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn('[anomaly] TELEGRAM_BOT_TOKEN not set — skipping notification');
      return;
    }

    // Determine recipient chat IDs
    let chatIds = [];

    if (process.env.TELEGRAM_CEO_CHAT_ID) {
      chatIds = [process.env.TELEGRAM_CEO_CHAT_ID];
    } else {
      // Fall back: broadcast to all team leads
      try {
        const leads = await sql`
          SELECT telegram_chat_id
          FROM users
          WHERE is_team_lead = true
            AND active = true
            AND telegram_chat_id IS NOT NULL
            AND telegram_chat_id <> ''
        `;
        chatIds = leads.map(l => l.telegram_chat_id);
      } catch (err) {
        console.error('[anomaly] Failed to fetch team leads for Telegram broadcast:', err.message);
        return;
      }
    }

    if (chatIds.length === 0) {
      console.warn('[anomaly] No Telegram recipients found — skipping notification');
      return;
    }

    const prefix = severity === 'critical' ? '🚨 *CRITICAL ALERT*\n\n' : '';
    const text   = prefix + message;
    const url    = `https://api.telegram.org/bot${token}/sendMessage`;

    for (const chatId of chatIds) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id:    chatId,
            text,
            parse_mode: 'Markdown',
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          console.error(`[anomaly] Telegram send failed for chat ${chatId}:`, err.description);
        }
      } catch (err) {
        console.error(`[anomaly] Telegram fetch error for chat ${chatId}:`, err.message);
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────

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
    const sql         = neon(process.env.DATABASE_URL);
    const sendTelegram = buildSendTelegram(sql);

    const result = await detectAnomalies(sql, sendTelegram);

    return res.status(200).json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cron/anomaly] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
