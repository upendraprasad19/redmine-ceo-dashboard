/**
 * crons/capacity.js
 * Every 2 hours — recalculate capacity status for all users.
 */

async function runCapacityUpdate() {
  try {
    const { updateCapacityStatus } = require('../intelligence/capacity')
    const results = await updateCapacityStatus()
    console.log(`[CRON] Capacity update: ${results.length} users processed`)
    return { processed: results.length, results }
  } catch (err) {
    console.error('[CRON] Capacity update failed:', err.message)
    return { processed: 0, error: err.message }
  }
}

module.exports = { runCapacityUpdate }
