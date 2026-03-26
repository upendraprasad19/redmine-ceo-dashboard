/**
 * bots/telegram/handlers/manager.js
 * Manager-specific formatting helpers for Telegram bot responses.
 * These helpers format raw data into clean Telegram-friendly messages.
 */

/**
 * Format a daily briefing for a manager.
 * @param {object} data - { kpis, overdueTickets, missingTimeLogs, projectRisks }
 * @returns {string} Formatted Telegram message
 */
function formatDailyBriefing(data) {
  const { kpis, overdueTickets, missingTimeLogs, projectRisks } = data;
  const lines = [];

  lines.push('📊 *Daily Briefing*\n');

  // KPIs
  if (kpis) {
    lines.push('*Key Metrics:*');
    lines.push(`  👥 Headcount: *${kpis.headcount || 0}*`);
    lines.push(`  🏖️ On Leave: *${kpis.on_leave || 0}*`);
    lines.push(`  🔴 Overdue Tickets: *${kpis.overdue_tickets || 0}*`);
    lines.push(`  ⏰ No Time Log Today: *${kpis.no_time_log || 0}*`);
    lines.push('');
  }

  // Overdue tickets
  if (overdueTickets && overdueTickets.length > 0) {
    lines.push(`🔴 *Overdue Tickets (${overdueTickets.length}):*`);
    for (const t of overdueTickets.slice(0, 10)) {
      const daysLate = t.due_date
        ? Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000)
        : '?';
      lines.push(`  • ${t.ticket_id || 'TK-' + t.id} — ${t.title}`);
      lines.push(`    👤 ${t.assigned_to || 'Unassigned'} | ⏰ ${daysLate}d overdue`);
    }
    lines.push('');
  }

  // Missing time logs
  if (missingTimeLogs && missingTimeLogs.length > 0) {
    lines.push(`🟡 *Missing Time Logs (${missingTimeLogs.length}):*`);
    const grouped = {};
    for (const m of missingTimeLogs) {
      const team = m.team || 'Unknown';
      if (!grouped[team]) grouped[team] = [];
      grouped[team].push(m.name);
    }
    for (const [team, names] of Object.entries(grouped)) {
      lines.push(`  *${team}:* ${names.join(', ')}`);
    }
    lines.push('');
  }

  // Project risks
  if (projectRisks && projectRisks.length > 0) {
    lines.push('🟡 *Projects at Risk:*');
    for (const p of projectRisks) {
      const riskEmoji = p.risk === 'high' ? '🔴' : p.risk === 'medium' ? '🟡' : '🟢';
      lines.push(`  ${riskEmoji} *${p.name}* — ${p.progress_pct || 0}% done, deadline: ${p.deadline || 'none'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format a cross-team comparison table.
 * @param {Array} teams - Array of team objects with metrics
 * @returns {string} Formatted comparison
 */
function formatTeamComparison(teams) {
  if (!teams || teams.length === 0) return 'No team data available.';

  const lines = ['📊 *Team Comparison*\n'];

  for (const t of teams) {
    const healthEmoji = (t.overall_score || 0) >= 80 ? '🟢' : (t.overall_score || 0) >= 60 ? '🟡' : '🔴';
    const trendEmoji = t.trend === 'up' ? '📈' : t.trend === 'down' ? '📉' : '➡️';

    lines.push(`${healthEmoji} *${t.team}*`);
    lines.push(`  Score: *${t.overall_score || 'N/A'}* ${trendEmoji}`);
    if (t.member_count) lines.push(`  Members: ${t.member_count} | Open tickets: ${t.open_tickets || 0}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format an escalation summary for managers.
 * @param {Array} escalations
 * @returns {string}
 */
function formatEscalations(escalations) {
  if (!escalations || escalations.length === 0) return '✅ No active escalations.';

  const lines = ['🚨 *Active Escalations*\n'];
  for (const e of escalations.slice(0, 5)) {
    const status = e.actioned ? '✅' : '🔴';
    lines.push(`${status} *${e.reason}*`);
    lines.push(`  Raised by: ${e.raised_by_name || 'Unknown'} → ${e.escalated_to_name || 'Unknown'}`);
    if (e.action_taken) lines.push(`  Action: ${e.action_taken}`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  formatDailyBriefing,
  formatTeamComparison,
  formatEscalations,
};
