/**
 * crons/insights.js
 * 12:05 AM daily — generate proactive insights for all dashboard users.
 */

async function runInsightGeneration() {
  try {
    const { generateAllInsights } = require('../intelligence/insights');
    const results = await generateAllInsights();
    const totalInsights = results.reduce((sum, r) => sum + (r.insights ? r.insights.length : 0), 0);
    console.log(`[CRON] Insight generation: ${results.length} users processed, ${totalInsights} insights generated`);
    return { users: results.length, insights: totalInsights, results };
  } catch (err) {
    console.error('[CRON] Insight generation failed:', err.message);
    return { users: 0, insights: 0, error: err.message };
  }
}

module.exports = { runInsightGeneration };
