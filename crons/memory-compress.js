/**
 * crons/memory-compress.js
 * Sunday midnight — compress old conversation memories across all users.
 */

async function runMemoryCompression() {
  try {
    const { compressAllMemories } = require('../intelligence/memory');
    const result = await compressAllMemories();
    console.log(`[CRON] Memory compression: ${result.compressed} users compressed`);
    return result;
  } catch (err) {
    console.error('[CRON] Memory compression failed:', err.message);
    return { compressed: 0, error: err.message };
  }
}

module.exports = { runMemoryCompression };
