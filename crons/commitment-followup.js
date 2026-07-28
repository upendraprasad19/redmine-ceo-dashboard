/**
 * crons/commitment-followup.js
 * For every pending commitment whose due_at has passed, DM the dev
 * asking [Yes, done] / [Needs more time] and mark it followed_up.
 */

const { findDueCommitments, markCommitment } = require('../lib/commitments')
const { sendTelegramMessage } = require('../lib/telegram')

async function tgSend(chatId, text, replyMarkup) {
  const result = await sendTelegramMessage(chatId, text, { reply_markup: replyMarkup })
  if (!result.ok) throw new Error(result.description || result.reason || 'Telegram send failed')
}

async function runCommitmentFollowup() {
  const due = await findDueCommitments()
  let followed = 0
  for (const c of due) {
    try {
      const link = c.issue_redmine_id
        ? `[TK-${c.issue_redmine_id}](https://redmine.thinkingcode.com/issues/${c.issue_redmine_id})`
        : 'that item'
      const msg = `You said '${c.promise_text}' on ${link}. Is it done?`
      const kb = {
        inline_keyboard: [
          [
            { text: 'Yes, done', callback_data: `int:commit_done:${c.id}` },
            { text: 'Needs more time', callback_data: `int:commit_extend:${c.id}` },
          ],
        ],
      }
      await tgSend(c.user_telegram_id, msg, kb)
      await markCommitment(c.id, 'followed_up')
      followed++
    } catch (e) {
      console.error('commitment followup failed', c.id, e.message)
    }
  }
  return { followed }
}

module.exports = { runCommitmentFollowup }
