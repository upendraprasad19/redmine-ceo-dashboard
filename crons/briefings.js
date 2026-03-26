/**
 * crons/briefings.js
 * 9:05 AM PM brief + 9:10 AM CEO brief — Telegram notifications.
 */

const { getDb } = require('../lib/db');

/**
 * Get the Telegraf bot instance (lazy-loaded to avoid startup issues).
 */
function getBot() {
  const { bot } = require('../bots/telegram');
  return bot;
}

// ────────────────────────────────────────────────────────────────
// sendCEOBrief — Morning brief for managers with org-wide overview
// ────────────────────────────────────────────────────────────────
async function sendCEOBrief() {
  const sql = getDb();
  const bot = getBot();
  const results = { sent: 0, errors: 0 };

  try {
    // 1. Gather org-wide metrics
    const [overdueRows, missingLogRows, leaveRows, blockedRows, capacityRows] = await Promise.all([
      // Overdue tickets
      sql`
        SELECT COUNT(*)::int AS count
        FROM issues
        WHERE due_date IS NOT NULL
          AND due_date < CURRENT_DATE
          AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
      `,
      // Users missing time log today
      sql`
        SELECT COUNT(*)::int AS count
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
      `,
      // On-leave count
      sql`
        SELECT COUNT(*)::int AS count
        FROM leave_records
        WHERE CURRENT_DATE BETWEEN start_date AND end_date
      `,
      // Blocked tickets
      sql`
        SELECT COUNT(*)::int AS count
        FROM issues
        WHERE status = 'Blocked'
      `,
      // Capacity alerts (overloaded users)
      sql`
        SELECT COUNT(*)::int AS count
        FROM capacity_status cs
        JOIN dashboard_users du ON du.id = cs.user_id
        WHERE cs.current_workload_pct >= 90
          AND du.active = true
      `,
    ]);

    const overdue = (overdueRows && overdueRows[0] && overdueRows[0].count) || 0;
    const missingLogs = (missingLogRows && missingLogRows[0] && missingLogRows[0].count) || 0;
    const onLeave = (leaveRows && leaveRows[0] && leaveRows[0].count) || 0;
    const blocked = (blockedRows && blockedRows[0] && blockedRows[0].count) || 0;
    const overloaded = (capacityRows && capacityRows[0] && capacityRows[0].count) || 0;

    // 2. Format message with severity emojis
    const overdueEmoji = overdue === 0 ? '\u2705' : overdue >= 5 ? '\ud83d\udd34' : '\ud83d\udfe1';
    const logEmoji = missingLogs === 0 ? '\u2705' : missingLogs >= 5 ? '\ud83d\udd34' : '\ud83d\udfe1';
    const blockedEmoji = blocked === 0 ? '\u2705' : '\ud83d\udd34';
    const capacityEmoji = overloaded === 0 ? '\u2705' : '\ud83d\udfe1';

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    const message = `*\ud83d\udcca CEO Morning Brief — ${today}*

${overdueEmoji} *Overdue Tickets:* ${overdue}
${blockedEmoji} *Blocked Tickets:* ${blocked}
${logEmoji} *Missing Time Logs:* ${missingLogs} people
\ud83c\udfd6\ufe0f *On Leave:* ${onLeave}
${capacityEmoji} *Overloaded (>90%):* ${overloaded} people

${overdue > 5 ? '\u26a0\ufe0f _Multiple overdue tickets require attention._\n' : ''}${blocked > 0 ? '\u26a0\ufe0f _' + blocked + ' ticket(s) are blocked and need unblocking._\n' : ''}${missingLogs > 5 ? '\u26a0\ufe0f _Several team members missing time logs._\n' : ''}
_Use /status for real-time details._`;

    // 3. Send to all managers via Telegram
    const managers = await sql`
      SELECT id, telegram_id, display_name
      FROM dashboard_users
      WHERE role = 'manager'
        AND active = true
        AND telegram_id IS NOT NULL
    `;

    for (const mgr of (managers || [])) {
      try {
        await bot.telegram.sendMessage(mgr.telegram_id, message, { parse_mode: 'Markdown' });
        results.sent++;
      } catch (sendErr) {
        console.error(`[CRON] CEO brief: failed to send to ${mgr.display_name}:`, sendErr.message);
        results.errors++;
      }
    }

    console.log('[CRON] CEO Brief completed:', JSON.stringify(results));
  } catch (err) {
    console.error('[CRON] CEO Brief failed:', err.message);
    results.errors++;
  }

  return results;
}

// ────────────────────────────────────────────────────────────────
// sendPMBriefs — Morning brief for each team lead with team-specific data
// ────────────────────────────────────────────────────────────────
async function sendPMBriefs() {
  const sql = getDb();
  const bot = getBot();
  const results = { sent: 0, errors: 0 };

  try {
    // Get all team leads with Telegram
    const teamLeads = await sql`
      SELECT id, telegram_id, display_name, team
      FROM dashboard_users
      WHERE role = 'team_lead'
        AND active = true
        AND telegram_id IS NOT NULL
    `;

    if (!teamLeads || teamLeads.length === 0) {
      console.log('[CRON] PM Briefs: no team leads with Telegram found');
      return results;
    }

    for (const lead of teamLeads) {
      try {
        const team = lead.team;
        if (!team) continue;

        // Get team member IDs
        const members = await sql`
          SELECT id FROM users WHERE team = ${team} AND active = true
        `;
        const memberIds = members ? members.map((m) => m.id) : [];
        if (memberIds.length === 0) continue;

        // Gather team metrics
        const [overdueRows, missingLogRows, blockedRows] = await Promise.all([
          sql`
            SELECT
              COUNT(*)::int AS count,
              ARRAY_AGG(
                COALESCE(redmine_id::text, id::text) || ': ' || COALESCE(title, 'Untitled')
              ) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')) AS list
            FROM issues
            WHERE assigned_to_id = ANY(${memberIds})
              AND due_date IS NOT NULL
              AND due_date < CURRENT_DATE
              AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
          `,
          sql`
            SELECT ARRAY_AGG(u.name) AS names
            FROM users u
            WHERE u.id = ANY(${memberIds})
              AND u.active = true
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
          `,
          sql`
            SELECT
              COUNT(*)::int AS count,
              ARRAY_AGG(
                COALESCE(redmine_id::text, id::text) || ': ' || COALESCE(title, 'Untitled')
              ) AS list
            FROM issues
            WHERE assigned_to_id = ANY(${memberIds})
              AND status = 'Blocked'
          `,
        ]);

        const overdue = (overdueRows && overdueRows[0]) || { count: 0, list: null };
        const missingNames = (missingLogRows && missingLogRows[0] && missingLogRows[0].names) || [];
        const blocked = (blockedRows && blockedRows[0]) || { count: 0, list: null };

        const overdueList = (overdue.list || []).slice(0, 5);
        const blockedList = (blocked.list || []).slice(0, 5);

        const today = new Date().toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });

        let message = `*\ud83d\udccb ${team} Team Brief — ${today}*\n\n`;

        // Overdue section
        if (overdue.count > 0) {
          message += `\ud83d\udd34 *${overdue.count} Overdue Ticket${overdue.count > 1 ? 's' : ''}:*\n`;
          for (const item of overdueList) {
            message += `  \u2022 ${item}\n`;
          }
          if (overdue.count > 5) {
            message += `  _...and ${overdue.count - 5} more_\n`;
          }
          message += '\n';
        } else {
          message += '\u2705 *No overdue tickets*\n\n';
        }

        // Blocked section
        if (blocked.count > 0) {
          message += `\ud83d\udeab *${blocked.count} Blocked Ticket${blocked.count > 1 ? 's' : ''}:*\n`;
          for (const item of blockedList) {
            message += `  \u2022 ${item}\n`;
          }
          message += '\n';
        }

        // Missing time logs
        if (missingNames.length > 0) {
          message += `\ud83d\udfe1 *Missing Time Log Today:*\n  ${missingNames.join(', ')}\n\n`;
        }

        message += '_Reply with any question for more details._';

        await bot.telegram.sendMessage(lead.telegram_id, message, { parse_mode: 'Markdown' });
        results.sent++;
      } catch (leadErr) {
        console.error(`[CRON] PM Brief: failed for ${lead.display_name}:`, leadErr.message);
        results.errors++;
      }
    }

    console.log('[CRON] PM Briefs completed:', JSON.stringify(results));
  } catch (err) {
    console.error('[CRON] PM Briefs failed:', err.message);
    results.errors++;
  }

  return results;
}

module.exports = { sendCEOBrief, sendPMBriefs };
