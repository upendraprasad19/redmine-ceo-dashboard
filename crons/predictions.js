/**
 * crons/predictions.js
 * Monday 8:30 AM — velocity-based deadline predictions for active projects.
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
// runVelocityPredictions — Predict deadline misses and alert managers
// ────────────────────────────────────────────────────────────────
async function runVelocityPredictions() {
  const sql = getDb()
  const bot = getBot()
  const results = { projectsChecked: 0, atRisk: 0, notified: 0, errors: 0 }

  try {
    const { predictDeadlineMiss } = require('../intelligence/velocity')

    // 1. Get all active projects with deadlines
    const projects = await sql`
      SELECT id, name, deadline
      FROM projects
      WHERE status = 'active'
        AND deadline IS NOT NULL
        AND deadline > CURRENT_DATE
      ORDER BY deadline ASC
    `

    if (!projects || projects.length === 0) {
      console.log('[CRON] Velocity Predictions: no active projects with deadlines')
      return results
    }

    // 2. Run predictions for each project
    const atRiskProjects = []

    for (const project of projects) {
      try {
        results.projectsChecked++
        const prediction = await predictDeadlineMiss(project.id)

        if (prediction.willMiss) {
          atRiskProjects.push(prediction)
          results.atRisk++
        }
      } catch (predErr) {
        console.error(
          `[CRON] Velocity Predictions: error for project ${project.name}:`,
          predErr.message,
        )
        results.errors++
      }
    }

    // 3. If any at-risk projects, alert managers
    if (atRiskProjects.length > 0) {
      const managers = await sql`
        SELECT telegram_id, display_name
        FROM dashboard_users
        WHERE role = 'manager'
          AND active = true
          AND telegram_id IS NOT NULL
      `

      let message = `*\ud83d\udea8 Deadline Risk Alert — ${atRiskProjects.length} Project${atRiskProjects.length > 1 ? 's' : ''} at Risk*\n\n`

      for (const pred of atRiskProjects) {
        const confidenceEmoji =
          pred.confidence === 'high'
            ? '\ud83d\udd34'
            : pred.confidence === 'medium'
              ? '\ud83d\udfe1'
              : '\u26aa'
        const deadlineStr = pred.deadline
          ? new Date(pred.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'N/A'

        message += `${confidenceEmoji} *${pred.projectName}*\n`
        message += `  Deadline: ${deadlineStr}\n`
        message += `  Remaining: ${pred.remaining} tickets\n`
        message += `  Velocity: ${pred.velocityPerWeek} tickets/week\n`
        message += `  Estimated miss: ~${pred.byDays} days\n`
        message += `  Confidence: ${pred.confidence}\n\n`
      }

      message += '_Review project scopes or allocate additional resources._'

      // Truncate for Telegram 4096 limit
      if (message.length > 4096) {
        message = `${message.substring(0, 4090)}...\u2026`
      }

      for (const mgr of managers || []) {
        try {
          await bot.telegram.sendMessage(mgr.telegram_id, message, { parse_mode: 'Markdown' })
          results.notified++
        } catch (sendErr) {
          if (sendErr.description?.includes("can't parse")) {
            try {
              await bot.telegram.sendMessage(mgr.telegram_id, message.replace(/\*/g, ''))
              results.notified++
            } catch (retryErr) {
              console.error(
                `[CRON] Velocity Predictions: retry failed for ${mgr.display_name}:`,
                retryErr.message,
              )
              results.errors++
            }
          } else {
            console.error(
              `[CRON] Velocity Predictions: failed for ${mgr.display_name}:`,
              sendErr.message,
            )
            results.errors++
          }
        }
      }
    }

    console.log('[CRON] Velocity Predictions completed:', JSON.stringify(results))
  } catch (err) {
    console.error('[CRON] Velocity Predictions failed:', err.message)
    results.errors++
  }

  return results
}

module.exports = { runVelocityPredictions }
