/**
 * crons/index.js
 * Master cron registry — registers all 13 cron jobs.
 * Each job is importable individually for manual triggering.
 *
 * Usage:
 *   const { startAllCrons } = require('./crons');
 *   startAllCrons();
 */

const cron = require('node-cron')

/**
 * Register and start all cron jobs.
 * All times are in server timezone (UTC on Vercel).
 */
function startAllCrons() {
  // ── Weekday morning routines ────────────────────────────────────
  // 1. 9:00 AM weekdays — Slack standup cards
  cron.schedule('0 9 * * 1-5', () => {
    require('./standup').runStandup()
  })

  // 2. 9:05 AM weekdays — PM team briefs via Telegram
  cron.schedule('5 9 * * 1-5', () => {
    require('./briefings').sendPMBriefs()
  })

  // 3. 9:10 AM weekdays — CEO morning brief via Telegram
  cron.schedule('10 9 * * 1-5', () => {
    require('./briefings').sendCEOBrief()
  })

  // ── End of day ──────────────────────────────────────────────────
  // 4. 6:00 PM weekdays — EOD time log check
  cron.schedule('0 18 * * 1-5', () => {
    require('./eod-alert').runEODAlert()
  })

  // ── Recurring ───────────────────────────────────────────────────
  // 5. Every 2 hours — capacity status update
  cron.schedule('0 */2 * * *', () => {
    require('./capacity').runCapacityUpdate()
  })

  // 6. Every 6 hours — silent ticket detector
  cron.schedule('0 */6 * * *', () => {
    require('./silence').runSilenceDetector()
  })

  // ── Weekly ──────────────────────────────────────────────────────
  // 7. Friday 4:00 PM — weekly reports
  cron.schedule('0 16 * * 5', () => {
    require('./reports').runWeeklyReports()
  })

  // ── Nightly ─────────────────────────────────────────────────────
  // 8. Midnight daily — performance scoring
  cron.schedule('0 0 * * *', () => {
    require('./performance').runPerformanceScoring()
  })

  // 9. 12:05 AM daily — insight generation
  cron.schedule('5 0 * * *', () => {
    require('./insights').runInsightGeneration()
  })

  // 10. 12:10 AM daily — team health calculation
  cron.schedule('10 0 * * *', () => {
    require('./team-health').runTeamHealthCalc()
  })

  // ── Weekly maintenance ──────────────────────────────────────────
  // 11. Sunday midnight — memory compression
  cron.schedule('0 0 * * 0', () => {
    require('./memory-compress').runMemoryCompression()
  })

  // ── Monday morning ─────────────────────────────────────────────
  // 12. Monday 8:00 AM — weekly pulse digest
  cron.schedule('0 8 * * 1', () => {
    require('./pulse-digest').runPulseDigest()
  })

  // 13. Monday 8:30 AM — velocity predictions
  cron.schedule('30 8 * * 1', () => {
    require('./predictions').runVelocityPredictions()
  })

  console.log('[CRON] All 13 cron jobs registered')
}

module.exports = { startAllCrons }
