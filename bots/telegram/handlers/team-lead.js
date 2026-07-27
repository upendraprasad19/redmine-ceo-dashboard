/**
 * bots/telegram/handlers/team-lead.js
 * Team lead-specific formatting helpers for Telegram bot responses.
 */

/**
 * Format a team status overview for team leads.
 * @param {object} data - { team, members, openTickets, blocked, missingLogs, onLeave }
 * @returns {string} Formatted Telegram message
 */
function formatTeamStatus(data) {
  const { team, members, openTickets, blocked, missingLogs, onLeave } = data
  const lines = []

  lines.push(`📋 *${team} Team Status*\n`)

  // Quick KPIs
  lines.push('*Quick Stats:*')
  lines.push(`  👥 Active Members: *${members || 0}*`)
  lines.push(`  📝 Open Tickets: *${openTickets || 0}*`)
  if (blocked > 0) lines.push(`  🔴 Blocked: *${blocked}*`)
  if (onLeave > 0) lines.push(`  🏖️ On Leave: *${onLeave}*`)
  if (missingLogs > 0) lines.push(`  ⏰ Missing Time Log: *${missingLogs}*`)
  lines.push('')

  return lines.join('\n')
}

/**
 * Format a member workload breakdown for team leads.
 * @param {Array} members - Array of member objects with ticket/hour data
 * @returns {string} Formatted workload view
 */
function formatMemberWorkload(members) {
  if (!members || members.length === 0) return 'No member data available.'

  const lines = ['👥 *Team Member Workload*\n']

  for (const m of members) {
    const workloadPct = parseFloat(m.current_workload_pct || 0)
    const loadEmoji = workloadPct >= 90 ? '🔴' : workloadPct >= 70 ? '🟡' : '🟢'

    lines.push(`${loadEmoji} *${m.name}*`)
    lines.push(
      `  Workload: ${workloadPct}% | Tickets: ${m.active_tickets || 0} | Available: ${m.available_capacity_pct || 0}%`,
    )
  }

  return lines.join('\n')
}

/**
 * Format 1-on-1 prep notes for a team member.
 * @param {object} data - { person, tickets, hours, blockers, performance }
 * @returns {string} Formatted prep notes
 */
function formatOneOnOnePrep(data) {
  const { person, tickets, hours, blockers, performance } = data
  const lines = []

  lines.push(`📝 *1-on-1 Prep: ${person.name}*`)
  lines.push(`Team: ${person.team} | Role: ${person.role}\n`)

  // Workload snapshot
  lines.push('*📊 Workload:*')
  lines.push(`  Open tickets: ${tickets?.open || 0}`)
  if (tickets?.overdue > 0) lines.push(`  🔴 Overdue: ${tickets.overdue}`)
  if (tickets?.blocked > 0) lines.push(`  🟡 Blocked: ${tickets.blocked}`)
  lines.push(`  Hours this week: ${hours?.this_week || 0}h`)
  lines.push(`  Hours this month: ${hours?.this_month || 0}h`)
  lines.push('')

  // Blockers
  if (blockers && blockers.length > 0) {
    lines.push('*🚧 Blockers to Discuss:*')
    for (const b of blockers) {
      lines.push(`  • ${b}`)
    }
    lines.push('')
  }

  // Performance
  if (performance) {
    const trendEmoji = performance.trend === 'up' ? '📈' : performance.trend === 'down' ? '📉' : '➡️'
    lines.push('*📈 Performance:*')
    lines.push(
      `  Score: *${performance.overall_score}* ${trendEmoji} (${performance.trend || 'stable'})`,
    )
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Format a list of team members who haven't logged time.
 * @param {Array} members - Array of { name, team }
 * @param {string} range - Time range label
 * @returns {string}
 */
function formatMissingTimeLogs(members, range) {
  if (!members || members.length === 0) {
    return `✅ All team members have logged time for ${range || 'today'}.`
  }

  const lines = [`⏰ *Missing Time Logs (${range || 'today'}): ${members.length} people*\n`]
  for (const m of members) {
    lines.push(`  • ${m.name}`)
  }

  return lines.join('\n')
}

module.exports = {
  formatTeamStatus,
  formatMemberWorkload,
  formatOneOnOnePrep,
  formatMissingTimeLogs,
}
