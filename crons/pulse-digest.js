/**
 * crons/pulse-digest.js
 * Monday 8 AM — weekly pulse digest with last week's summary.
 */

const { getDb } = require('../lib/db')

/**
 * Get the Telegraf bot instance.
 */
function getBot() {
  const { bot } = require('../bots/telegram')
  return bot
}

// ────────────────────────────────────────────────────────────────
// runPulseDigest — Compile and send a weekly pulse to all leads/managers
// ────────────────────────────────────────────────────────────────
async function runPulseDigest() {
  const sql = getDb()
  const bot = getBot()
  const results = { sent: 0, errors: 0 }

  try {
    // Date range: last 7 days
    const lastWeekStart = new Date()
    lastWeekStart.setDate(lastWeekStart.getDate() - 7)
    const sinceStr = lastWeekStart.toISOString().slice(0, 10)

    // 1. Get overall metrics for last week
    const [completedRows, hoursRows, newBlockersRows, activeProjectRows] = await Promise.all([
      // Tickets completed last week
      sql`
        SELECT
          COUNT(*)::int AS completed,
          COUNT(DISTINCT assigned_to_id)::int AS contributors
        FROM issues
        WHERE closed_at >= ${sinceStr}::date
      `,
      // Hours logged last week
      sql`
        SELECT
          COALESCE(SUM(hours), 0)::float AS total_hours,
          COUNT(DISTINCT user_id)::int AS loggers
        FROM time_entries
        WHERE spent_on >= ${sinceStr}::date
      `,
      // New blockers last week
      sql`
        SELECT COUNT(*)::int AS count
        FROM issues
        WHERE status = 'Blocked'
          AND updated_at >= ${sinceStr}::date
      `,
      // Active projects with deadlines
      sql`
        SELECT id, name, deadline
        FROM projects
        WHERE status = 'active'
          AND deadline IS NOT NULL
          AND deadline > CURRENT_DATE
        ORDER BY deadline ASC
      `,
    ])

    const completed = completedRows?.[0] || { completed: 0, contributors: 0 }
    const hours = hoursRows?.[0] || { total_hours: 0, loggers: 0 }
    const newBlockers = newBlockersRows?.[0]?.count || 0
    const activeProjects = activeProjectRows || []

    // 2. Get velocity predictions for active projects
    const { predictDeadlineMiss } = require('../intelligence/velocity')
    const predictions = []

    for (const proj of activeProjects.slice(0, 10)) {
      try {
        const pred = await predictDeadlineMiss(proj.id)
        if (pred.willMiss) {
          predictions.push(pred)
        }
      } catch (_predErr) {
        // Skip prediction errors
      }
    }

    // 3. Per-team breakdown
    const teamBreakdown = await sql`
      SELECT
        u.team,
        COUNT(i.id) FILTER (WHERE i.closed_at >= ${sinceStr}::date)::int AS completed,
        COALESCE(SUM(te.hours), 0)::float AS hours
      FROM users u
      LEFT JOIN issues i ON i.assigned_to_id = u.id AND i.closed_at >= ${sinceStr}::date
      LEFT JOIN time_entries te ON te.user_id = u.id AND te.spent_on >= ${sinceStr}::date
      WHERE u.active = true AND u.team IS NOT NULL
      GROUP BY u.team
      ORDER BY completed DESC
    `

    // 4. Format the pulse message
    const weekRange = `${sinceStr} to ${new Date().toISOString().slice(0, 10)}`

    let message = `*\ud83d\udcab Weekly Pulse Digest*\n_${weekRange}_\n\n`

    message += `*\ud83d\udcca Summary:*\n`
    message += `  \u2705 *${completed.completed}* tickets completed by *${completed.contributors}* contributors\n`
    message += `  \u23f1 *${Math.round(hours.total_hours)}* hours logged by *${hours.loggers}* people\n`
    message += `  \ud83d\udeab *${newBlockers}* new/active blockers\n\n`

    // Team breakdown
    if (teamBreakdown && teamBreakdown.length > 0) {
      message += `*\ud83d\udc65 Team Breakdown:*\n`
      for (const team of teamBreakdown) {
        message += `  \u2022 *${team.team}:* ${team.completed} completed, ${Math.round(team.hours)}h logged\n`
      }
      message += '\n'
    }

    // Deadline risks
    if (predictions.length > 0) {
      message += `*\u26a0\ufe0f Deadline Risks:*\n`
      for (const pred of predictions) {
        message += `  \ud83d\udd34 *${pred.projectName}* — may miss by ~${pred.byDays} days (${pred.confidence} confidence)\n`
      }
      message += '\n'
    }

    message += '_Start the week strong! Reply with any question for details._'

    // 5. Send to all managers and team leads
    const recipients = await sql`
      SELECT telegram_id, display_name
      FROM dashboard_users
      WHERE role IN ('manager', 'team_lead')
        AND active = true
        AND telegram_id IS NOT NULL
    `

    for (const user of recipients || []) {
      try {
        await bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        results.sent++
      } catch (sendErr) {
        // Retry without Markdown on parse error
        if (sendErr.description?.includes("can't parse")) {
          try {
            await bot.telegram.sendMessage(user.telegram_id, message.replace(/\*/g, ''))
            results.sent++
          } catch (retryErr) {
            console.error(
              `[CRON] Pulse Digest: retry failed for ${user.display_name}:`,
              retryErr.message,
            )
            results.errors++
          }
        } else {
          console.error(`[CRON] Pulse Digest: failed for ${user.display_name}:`, sendErr.message)
          results.errors++
        }
      }
    }

    console.log('[CRON] Pulse Digest completed:', JSON.stringify(results))
  } catch (err) {
    console.error('[CRON] Pulse Digest failed:', err.message)
    results.errors++
  }

  return results
}

module.exports = { runPulseDigest }
