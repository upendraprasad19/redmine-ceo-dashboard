/**
 * pages/api/cron/reminder-delivery.js
 * Checks for pending user reminders and delivers them via Telegram.
 * Cron: hourly via batch handler (previously every 15 min via phase1-tick.js)
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
    const result = await runReminderDelivery()
    return res.status(200).json(result)
  } catch (err) {
    return send500(res, err)
  }
}

export async function runReminderDelivery() {
  const sql = getDb()

  const due = await sql`
    SELECT id, telegram_id, message, remind_at
    FROM user_reminders
    WHERE sent = false AND remind_at <= NOW()
    ORDER BY remind_at ASC
    LIMIT 50
  `

  let sent = 0
  for (const reminder of due) {
    const result = await sendTelegramMessage(reminder.telegram_id, `⏰ *Reminder*\n\n${reminder.message}`)
    if (result.ok) {
      await sql`UPDATE user_reminders SET sent = true WHERE id = ${reminder.id}`
      sent++
    }
  }

  return { ok: true, sent, total: due.length }
}
