/**
 * pages/api/cron/missing-log-reminder.js
 * Reminds users who haven't logged time by 5 PM IST.
 * Cron: 12:00 UTC Mon-Fri (shifted from 11:30 to align with batch handler :00)
 * Protected by CRON_SECRET header (dual auth: Bearer or x-cron-secret).
 */

import { getDb } from '../../../lib/db'
import { sendTelegramMessage } from '../../../lib/telegram'
import { send500 } from '../../../lib/api-error'

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end()

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET not configured' })

  const bearerToken = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null
  const headerSecret = req.headers['x-cron-secret']
  if (bearerToken !== cronSecret && headerSecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const result = await runMissingLogReminder()
    return res.status(200).json(result)
  } catch (err) {
    return send500(res, err)
  }
}

export async function runMissingLogReminder() {
  const day = new Date().getDay()
  if (day === 0 || day === 6) return { ok: true, skipped: 'weekend' }

  const sql = getDb()

  const missing = await sql`
    SELECT du.id, du.display_name, du.telegram_id
    FROM dashboard_users du
    JOIN users u ON u.id = du.linked_redmine_user_id
    WHERE du.active = true
      AND du.telegram_id IS NOT NULL
      AND u.active = true
      AND NOT EXISTS (
        SELECT 1 FROM time_entries te
        WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE
      )
  `

  let sent = 0
  for (const user of missing) {
    const msg = `⏰ *Time Log Reminder*\n\nHey ${user.display_name}! You haven't logged your time yet today.\n\nDon't forget before EOD 📝`
    const result = await sendTelegramMessage(user.telegram_id, msg)
    if (result.ok) sent++
  }

  return { ok: true, sent, total: missing.length }
}
