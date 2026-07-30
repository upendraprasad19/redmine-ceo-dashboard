/**
 * crons/performance.js
 * Midnight daily — compute and store performance scores for all users.
 */

async function runPerformanceScoring() {
  try {
    const { calculatePerformanceScores } = require('../intelligence/performance')
    const allResults = []
    for (const period of ['daily', 'weekly', 'monthly']) {
      const results = await calculatePerformanceScores(period)
      console.log(`[CRON] Performance scoring (${period}): ${results.length} users scored`)
      allResults.push(...results)
    }
    return { scored: allResults.length, results: allResults }
  } catch (err) {
    console.error('[CRON] Performance scoring failed:', err.message)
    return { scored: 0, error: err.message }
  }
}

module.exports = { runPerformanceScoring }
