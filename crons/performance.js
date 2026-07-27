/**
 * crons/performance.js
 * Midnight daily — compute and store performance scores for all users.
 */

async function runPerformanceScoring() {
  try {
    const { calculatePerformanceScores } = require('../intelligence/performance')
    const results = await calculatePerformanceScores('daily')
    console.log(`[CRON] Performance scoring: ${results.length} users scored`)
    return { scored: results.length, results }
  } catch (err) {
    console.error('[CRON] Performance scoring failed:', err.message)
    return { scored: 0, error: err.message }
  }
}

module.exports = { runPerformanceScoring }
