/**
 * crons/reports.js
 * Friday 4 PM — generate and send weekly reports to managers/team leads.
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
// runWeeklyReports — Generate and distribute weekly reports
// ────────────────────────────────────────────────────────────────
async function runWeeklyReports() {
  const sql = getDb()
  const bot = getBot()
  const results = { generated: 0, telegramSent: 0, emailSent: 0, errors: 0 }

  try {
    const { generateWeeklyReport } = require('../intelligence/reports')
    const { sendReport: sendEmailReport } = require('../lib/email')

    // Get all managers and team leads
    const recipients = await sql`
      SELECT id, telegram_id, display_name, role, team
      FROM dashboard_users
      WHERE role IN ('manager', 'team_lead')
        AND active = true
    `

    if (!recipients || recipients.length === 0) {
      console.log('[CRON] Weekly Reports: no recipients found')
      return results
    }

    for (const user of recipients) {
      try {
        // 1. Generate the report
        const report = await generateWeeklyReport(user.id)

        if (report.error) {
          console.error(`[CRON] Weekly Reports: error for ${user.display_name}:`, report.error)
          results.errors++
          continue
        }

        results.generated++

        // 2. Send via Telegram if user has telegram_id
        if (user.telegram_id && report.summary) {
          try {
            // Telegram has 4096 char limit — truncate if needed
            let telegramMsg = `*\ud83d\udcca Weekly Report — ${report.generatedAt.slice(0, 10)}*\n\n${report.summary}`

            if (telegramMsg.length > 4096) {
              telegramMsg = `${telegramMsg.substring(0, 4090)}...\u2026`
            }

            await bot.telegram.sendMessage(user.telegram_id, telegramMsg, {
              parse_mode: 'Markdown',
            })
            results.telegramSent++
          } catch (tgErr) {
            // Retry without Markdown on parse error
            if (tgErr.description?.includes("can't parse")) {
              try {
                const plainMsg = `Weekly Report — ${report.generatedAt.slice(0, 10)}\n\n${report.summary}`
                await bot.telegram.sendMessage(user.telegram_id, plainMsg.substring(0, 4096))
                results.telegramSent++
              } catch (retryErr) {
                console.error(
                  `[CRON] Weekly Reports: Telegram retry failed for ${user.display_name}:`,
                  retryErr.message,
                )
                results.errors++
              }
            } else {
              console.error(
                `[CRON] Weekly Reports: Telegram failed for ${user.display_name}:`,
                tgErr.message,
              )
              results.errors++
            }
          }
        }

        // 3. Send via email if user has email
        if (user.email && report.summary) {
          try {
            const subject = `Weekly Report — ${report.generatedAt.slice(0, 10)}`

            // Build HTML email from Markdown-ish summary
            const htmlBody = `
              <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
                <h2 style="color: #333;">Weekly Report</h2>
                <p style="color: #666; font-size: 14px;">${report.generatedAt.slice(0, 10)} | Generated for ${user.display_name}</p>
                <hr style="border: 1px solid #eee;">
                <div style="white-space: pre-wrap; line-height: 1.6;">
${report.summary.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}
                </div>
                <hr style="border: 1px solid #eee;">
                <p style="color: #999; font-size: 12px;">Company OS — Automated Weekly Report</p>
              </div>
            `.trim()

            await sendEmailReport(user.email, subject, htmlBody)
            results.emailSent++
          } catch (emailErr) {
            console.error(
              `[CRON] Weekly Reports: email failed for ${user.display_name}:`,
              emailErr.message,
            )
            results.errors++
          }
        }
      } catch (userErr) {
        console.error(`[CRON] Weekly Reports: error for ${user.display_name}:`, userErr.message)
        results.errors++
      }
    }

    console.log('[CRON] Weekly Reports completed:', JSON.stringify(results))
  } catch (err) {
    console.error('[CRON] Weekly Reports failed:', err.message)
    results.errors++
  }

  return results
}

module.exports = { runWeeklyReports }
