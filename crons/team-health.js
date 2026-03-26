/**
 * crons/team-health.js
 * 12:10 AM daily — compute team health scores for all teams.
 */

async function runTeamHealthCalc() {
  try {
    const { computeTeamHealthScores } = require('../intelligence/team-health');
    const results = await computeTeamHealthScores();
    console.log(`[CRON] Team health: ${results.length} teams scored`);
    return { teams: results.length, results };
  } catch (err) {
    console.error('[CRON] Team health failed:', err.message);
    return { teams: 0, error: err.message };
  }
}

module.exports = { runTeamHealthCalc };
