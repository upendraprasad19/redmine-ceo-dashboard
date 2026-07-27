/**
 * crons/silence.js
 * Every 6 hours — detect silent tickets (no updates in 5+ days).
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
// runSilenceDetector — Find tickets with no activity for 5+ days
// ────────────────────────────────────────────────────────────────
async function runSilenceDetector() {
  const sql = getDb()
  const bot = getBot()
  const results = { silentTickets: 0, notified: 0, errors: 0 }

  try {
    // 1. Find active tickets not updated in 5+ days
    //    Check both updated_at on issues and any journal entries
    const silentTickets = await sql`
      SELECT
        i.id,
        i.redmine_id,
        i.title,
        i.status,
        i.assigned_to_id,
        i.updated_at,
        u.name AS assignee_name,
        u.team,
        EXTRACT(DAY FROM NOW() - i.updated_at)::int AS days_silent
      FROM issues i
      LEFT JOIN users u ON u.id = i.assigned_to_id
      WHERE i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
        AND i.updated_at < NOW() - INTERVAL '5 days'
        AND NOT EXISTS (
          SELECT 1 FROM issue_journals ij
          WHERE ij.issue_id = i.id
            AND ij.created_at >= NOW() - INTERVAL '5 days'
        )
      ORDER BY i.updated_at ASC
      LIMIT 50
    `

    if (!silentTickets || silentTickets.length === 0) {
      console.log('[CRON] Silence Detector: no silent tickets found')
      return results
    }

    results.silentTickets = silentTickets.length

    // 2. Group by team
    const teamMap = {}
    for (const ticket of silentTickets) {
      const team = ticket.team || 'Unassigned'
      if (!teamMap[team]) teamMap[team] = []
      teamMap[team].push(ticket)
    }

    // 3. Notify team leads for each team
    for (const [team, tickets] of Object.entries(teamMap)) {
      try {
        const leads = await sql`
          SELECT telegram_id, display_name
          FROM dashboard_users
          WHERE team = ${team}
            AND role IN ('team_lead', 'manager')
            AND active = true
            AND telegram_id IS NOT NULL
        `

        if (!leads || leads.length === 0) continue

        const ticketList = tickets.slice(0, 10).map((t) => {
          const id = t.redmine_id ? `#${t.redmine_id}` : `#${t.id}`
          return `  \u2022 ${id}: ${t.title} _(${t.days_silent}d silent, ${t.assignee_name || 'unassigned'})_`
        })

        let message = `\ud83d\udd07 *Silent Tickets — ${team}*

${tickets.length} ticket${tickets.length > 1 ? 's have' : ' has'} had no updates in 5+ days:

${ticketList.join('\n')}`

        if (tickets.length > 10) {
          message += `\n  _...and ${tickets.length - 10} more_`
        }

        message += '\n\n_These tickets may need attention or status updates._'

        for (const lead of leads) {
          try {
            await bot.telegram.sendMessage(lead.telegram_id, message, { parse_mode: 'Markdown' })
            results.notified++
          } catch (sendErr) {
            console.error(`[CRON] Silence: failed to notify ${lead.display_name}:`, sendErr.message)
            results.errors++
          }
        }
      } catch (teamErr) {
        console.error(`[CRON] Silence: error for team ${team}:`, teamErr.message)
        results.errors++
      }
    }

    console.log('[CRON] Silence Detector completed:', JSON.stringify(results))
  } catch (err) {
    console.error('[CRON] Silence Detector failed:', err.message)
    results.errors++
  }

  return results
}

module.exports = { runSilenceDetector }
