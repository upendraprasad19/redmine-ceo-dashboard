/**
 * crons/eod-alert.js
 * 6 PM weekday EOD time log check — notifies team leads about missing logs.
 */

const { getDb } = require('../lib/db');

/**
 * Get the Telegraf bot instance.
 */
function getBot() {
  const { bot } = require('../bots/telegram');
  return bot;
}

// ────────────────────────────────────────────────────────────────
// runEODAlert — Find users who haven't logged time today and notify leads
// ────────────────────────────────────────────────────────────────
async function runEODAlert() {
  const sql = getDb();
  const bot = getBot();
  const results = { notified: 0, missingCount: 0, errors: 0 };

  try {
    // 1. Find users who haven't logged time today (excluding those on leave)
    const noLogUsers = await sql`
      SELECT u.id, u.name, u.team
      FROM users u
      WHERE u.active = true
        AND NOT EXISTS (
          SELECT 1 FROM time_entries te
          WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE
        )
        AND NOT EXISTS (
          SELECT 1 FROM leave_records lr
          WHERE lr.user_id = u.id
            AND lr.start_date <= CURRENT_DATE
            AND lr.end_date >= CURRENT_DATE
        )
      ORDER BY u.team, u.name
    `;

    if (!noLogUsers || noLogUsers.length === 0) {
      console.log('[CRON] EOD Alert: everyone logged time today');
      return results;
    }

    results.missingCount = noLogUsers.length;

    // 2. Group by team
    const teamMap = {};
    for (const user of noLogUsers) {
      const team = user.team || 'Unassigned';
      if (!teamMap[team]) teamMap[team] = [];
      teamMap[team].push(user.name);
    }

    // 3. Notify each team lead
    for (const [team, names] of Object.entries(teamMap)) {
      try {
        const leads = await sql`
          SELECT telegram_id, display_name
          FROM dashboard_users
          WHERE team = ${team}
            AND role = 'team_lead'
            AND active = true
            AND telegram_id IS NOT NULL
        `;

        if (!leads || leads.length === 0) continue;

        const message = `\u23f0 *EOD Time Log Alert — ${team}*

${names.length} team member${names.length > 1 ? 's have' : ' has'} not logged time today:

${names.map((n) => `  \u2022 ${n}`).join('\n')}

_Please follow up before end of day._`;

        for (const lead of leads) {
          try {
            await bot.telegram.sendMessage(lead.telegram_id, message, { parse_mode: 'Markdown' });
            results.notified++;
          } catch (sendErr) {
            console.error(`[CRON] EOD Alert: failed to notify ${lead.display_name}:`, sendErr.message);
            results.errors++;
          }
        }
      } catch (teamErr) {
        console.error(`[CRON] EOD Alert: error for team ${team}:`, teamErr.message);
        results.errors++;
      }
    }

    // 4. If total missing count is high, also notify managers
    if (noLogUsers.length >= 5) {
      try {
        const managers = await sql`
          SELECT telegram_id, display_name
          FROM dashboard_users
          WHERE role = 'manager'
            AND active = true
            AND telegram_id IS NOT NULL
        `;

        const teamSummary = Object.entries(teamMap)
          .map(([team, names]) => `  \u2022 *${team}:* ${names.length} missing`)
          .join('\n');

        const mgrMessage = `\ud83d\udea8 *EOD Alert: ${noLogUsers.length} people missing time logs*

${teamSummary}

_This is above the threshold of 5. Team leads have been notified._`;

        for (const mgr of (managers || [])) {
          try {
            await bot.telegram.sendMessage(mgr.telegram_id, mgrMessage, { parse_mode: 'Markdown' });
            results.notified++;
          } catch (sendErr) {
            console.error(`[CRON] EOD Alert: failed to notify manager ${mgr.display_name}:`, sendErr.message);
            results.errors++;
          }
        }
      } catch (mgrErr) {
        console.error('[CRON] EOD Alert: error notifying managers:', mgrErr.message);
        results.errors++;
      }
    }

    console.log('[CRON] EOD Alert completed:', JSON.stringify(results));
  } catch (err) {
    console.error('[CRON] EOD Alert failed:', err.message);
    results.errors++;
  }

  return results;
}

module.exports = { runEODAlert };
