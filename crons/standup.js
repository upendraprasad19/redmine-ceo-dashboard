/**
 * crons/standup.js
 * 9 AM weekday standup — sends Slack standup cards to all developers.
 */

async function runStandup() {
  try {
    const { sendStandup } = require('../bots/slack/standup')
    const result = await sendStandup()
    console.log('[CRON] Standup completed:', JSON.stringify(result))
    return result
  } catch (err) {
    console.error('[CRON] Standup failed:', err.message)
    return { sent: 0, errors: 1, skipped: 0, error: err.message }
  }
}

module.exports = { runStandup }
