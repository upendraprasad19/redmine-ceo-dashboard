/**
 * crons/intimation-followup.js
 * - Nudges unanswered threads at 4h (status: sent -> timeout_nudged).
 * - Closes unanswered threads at 24h (status: timeout_nudged -> no_response),
 *   notifying the originator with escalate/close buttons.
 */

const { getDb } = require('../lib/db')
const { logEvent, transitionStatus } = require('../lib/intimation-relay')

async function tgSend(chat_id, text, reply_markup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const body = { chat_id, text, parse_mode: 'Markdown' }
  if (reply_markup) body.reply_markup = reply_markup
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`)
}

async function runIntimationFollowup() {
  const sql = getDb()
  let nudged = 0,
    closed = 0

  // 4h nudge: status='sent' AND last_event_at < now - 4h
  const toNudge = await sql`
    SELECT t.id, t.target_id, t.originator_id, t.issue_id,
           tgt.display_name AS target_name, tgt.telegram_id AS target_tg,
           orig.display_name AS originator_name,
           i.redmine_id
      FROM bot_threads t
      JOIN dashboard_users tgt ON tgt.id = t.target_id
      JOIN dashboard_users orig ON orig.id = t.originator_id
      JOIN issues i ON i.id = t.issue_id
     WHERE t.status = 'sent'
       AND t.last_event_at < NOW() - INTERVAL '4 hours'
     LIMIT 50
  `
  for (const row of toNudge) {
    try {
      const msg = `Gentle reminder — *${row.originator_name}* is waiting on status for [TK-${row.redmine_id}](https://redmine.thinkingcode.com/issues/${row.redmine_id}).`
      await tgSend(row.target_tg, msg)
      await logEvent({
        thread_id: row.id,
        actor_id: null,
        event_type: 'nudged',
        payload: { reason: '4h_no_response' },
      })
      await transitionStatus(row.id, 'timeout_nudged')
      nudged++
    } catch (e) {
      console.error('nudge failed', row.id, e.message)
    }
  }

  // 24h close: status='timeout_nudged' AND created_at < now - 24h
  const toClose = await sql`
    SELECT t.id, t.originator_id, t.issue_id, t.cc_user_id, t.target_id,
           orig.display_name AS originator_name, orig.telegram_id AS originator_tg,
           tgt.display_name AS target_name,
           i.redmine_id
      FROM bot_threads t
      JOIN dashboard_users orig ON orig.id = t.originator_id
      JOIN dashboard_users tgt ON tgt.id = t.target_id
      JOIN issues i ON i.id = t.issue_id
     WHERE t.status = 'timeout_nudged'
       AND t.created_at < NOW() - INTERVAL '24 hours'
     LIMIT 50
  `
  for (const row of toClose) {
    try {
      const msg = `*${row.target_name}* hasn't responded about [TK-${row.redmine_id}](https://redmine.thinkingcode.com/issues/${row.redmine_id}) in 24h.`
      const kb = {
        inline_keyboard: [
          [
            { text: 'Escalate to TL', callback_data: `int:escalate:${row.id}` },
            { text: 'Close', callback_data: `int:close:${row.id}` },
          ],
        ],
      }
      await tgSend(row.originator_tg, msg, kb)
      await transitionStatus(row.id, 'no_response')
      await logEvent({
        thread_id: row.id,
        actor_id: null,
        event_type: 'closed',
        payload: { reason: '24h_no_response' },
      })
      closed++
    } catch (e) {
      console.error('close failed', row.id, e.message)
    }
  }

  return { nudged, closed }
}

module.exports = { runIntimationFollowup }
