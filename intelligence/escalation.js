/**
 * intelligence/escalation.js
 * Rule-based escalation engine: detects problems and escalates to the right person.
 */

const { getDb } = require('../lib/db')

// ────────────────────────────────────────────────────────────────
// Escalation rules
// ────────────────────────────────────────────────────────────────
const ESCALATION_RULES = [
  {
    name: 'ticket_overdue_3_days',
    description: 'Ticket overdue by more than 3 days',
    severity: 'high',
  },
  {
    name: 'no_timelog_2_days',
    description: 'User has no time log for 2+ consecutive working days',
    severity: 'medium',
  },
  {
    name: 'blocked_24h',
    description: 'Ticket blocked for more than 24 hours',
    severity: 'critical',
  },
  {
    name: 'capacity_underloaded',
    description: 'User below 30% workload for 5+ consecutive days',
    severity: 'low',
  },
]

// ────────────────────────────────────────────────────────────────
// runEscalationEngine — Check all rules, log triggered escalations
// ────────────────────────────────────────────────────────────────
async function runEscalationEngine() {
  const sql = getDb()
  const triggered = []

  try {
    // ── Rule 1: Tickets overdue by > 3 days ─────────────────────
    try {
      const overdueTickets = await sql`
        SELECT
          i.id, i.redmine_id, i.title, i.due_date, i.assigned_to_id,
          u.name AS assignee_name, u.team,
          EXTRACT(DAY FROM NOW() - i.due_date::timestamptz)::int AS days_overdue
        FROM issues i
        LEFT JOIN users u ON u.id = i.assigned_to_id
        WHERE i.due_date IS NOT NULL
          AND i.due_date < CURRENT_DATE - INTERVAL '3 days'
          AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
      `

      if (overdueTickets && overdueTickets.length > 0) {
        for (const ticket of overdueTickets) {
          // Check if this escalation was already raised today
          const existing = await sql`
            SELECT id FROM escalation_log
            WHERE rule_triggered = 'ticket_overdue_3_days'
              AND context->>'ticket_id' = ${String(ticket.redmine_id || ticket.id)}
              AND triggered_at >= CURRENT_DATE
            LIMIT 1
          `
          if (existing && existing.length > 0) continue

          // Find who to escalate to: team lead for the assignee's team
          const escalateTo = await findEscalationTarget(sql, ticket.team)

          const context = {
            ticket_id: String(ticket.redmine_id || ticket.id),
            title: ticket.title,
            assignee: ticket.assignee_name,
            team: ticket.team,
            days_overdue: ticket.days_overdue,
            due_date: ticket.due_date,
          }

          await sql`
            INSERT INTO escalation_log (
              rule_triggered, context, action_taken, escalated_to, triggered_at
            ) VALUES (
              'ticket_overdue_3_days',
              ${JSON.stringify(context)}::jsonb,
              ${`Ticket #${ticket.redmine_id || ticket.id} is ${ticket.days_overdue} days overdue. Assigned to ${ticket.assignee_name || 'unassigned'}.`},
              ${escalateTo},
              NOW()
            )
          `

          triggered.push({
            rule: 'ticket_overdue_3_days',
            severity: 'high',
            context,
            escalatedTo: escalateTo,
          })
        }
      }
    } catch (ruleErr) {
      console.error('escalation: ticket_overdue_3_days error:', ruleErr.message)
    }

    // ── Rule 2: No time log for 2+ working days ────────────────
    try {
      const noLogUsers = await sql`
        SELECT
          u.id, u.name, u.team,
          MAX(te.spent_on) AS last_logged
        FROM users u
        LEFT JOIN time_entries te ON te.user_id = u.id
        WHERE u.active = true
        GROUP BY u.id, u.name, u.team
        HAVING MAX(te.spent_on) IS NULL
           OR MAX(te.spent_on) < CURRENT_DATE - INTERVAL '2 days'
      `

      if (noLogUsers && noLogUsers.length > 0) {
        for (const user of noLogUsers) {
          // Skip if on leave
          const onLeave = await sql`
            SELECT id FROM leave_records
            WHERE user_id = ${user.id}
              AND start_date <= CURRENT_DATE
              AND end_date >= CURRENT_DATE
            LIMIT 1
          `
          if (onLeave && onLeave.length > 0) continue

          // Check if already escalated today
          const existing = await sql`
            SELECT id FROM escalation_log
            WHERE rule_triggered = 'no_timelog_2_days'
              AND context->>'user_id' = ${String(user.id)}
              AND triggered_at >= CURRENT_DATE
            LIMIT 1
          `
          if (existing && existing.length > 0) continue

          const escalateTo = await findEscalationTarget(sql, user.team)
          const daysSince = user.last_logged
            ? Math.floor(
                (Date.now() - new Date(user.last_logged).getTime()) / (1000 * 60 * 60 * 24),
              )
            : null

          const context = {
            user_id: String(user.id),
            user_name: user.name,
            team: user.team,
            last_logged: user.last_logged,
            days_since: daysSince,
          }

          await sql`
            INSERT INTO escalation_log (
              rule_triggered, context, action_taken, escalated_to, triggered_at
            ) VALUES (
              'no_timelog_2_days',
              ${JSON.stringify(context)}::jsonb,
              ${`${user.name} has not logged time for ${daysSince !== null ? `${daysSince} days` : 'an unknown period'}. Not on leave.`},
              ${escalateTo},
              NOW()
            )
          `

          triggered.push({
            rule: 'no_timelog_2_days',
            severity: 'medium',
            context,
            escalatedTo: escalateTo,
          })
        }
      }
    } catch (ruleErr) {
      console.error('escalation: no_timelog_2_days error:', ruleErr.message)
    }

    // ── Rule 3: Blocked tickets for > 24 hours ─────────────────
    try {
      const blockedTickets = await sql`
        SELECT
          i.id, i.redmine_id, i.title, i.assigned_to_id,
          u.name AS assignee_name, u.team,
          i.updated_at AS blocked_since
        FROM issues i
        LEFT JOIN users u ON u.id = i.assigned_to_id
        WHERE i.status = 'Blocked'
          AND i.updated_at < NOW() - INTERVAL '24 hours'
      `

      if (blockedTickets && blockedTickets.length > 0) {
        for (const ticket of blockedTickets) {
          const existing = await sql`
            SELECT id FROM escalation_log
            WHERE rule_triggered = 'blocked_24h'
              AND context->>'ticket_id' = ${String(ticket.redmine_id || ticket.id)}
              AND triggered_at >= CURRENT_DATE
            LIMIT 1
          `
          if (existing && existing.length > 0) continue

          const escalateTo = await findEscalationTarget(sql, ticket.team)
          const hoursBlocked = Math.round(
            (Date.now() - new Date(ticket.blocked_since).getTime()) / (1000 * 60 * 60),
          )

          const context = {
            ticket_id: String(ticket.redmine_id || ticket.id),
            title: ticket.title,
            assignee: ticket.assignee_name,
            team: ticket.team,
            hours_blocked: hoursBlocked,
            blocked_since: ticket.blocked_since,
          }

          await sql`
            INSERT INTO escalation_log (
              rule_triggered, context, action_taken, escalated_to, triggered_at
            ) VALUES (
              'blocked_24h',
              ${JSON.stringify(context)}::jsonb,
              ${`Ticket #${ticket.redmine_id || ticket.id} has been blocked for ${hoursBlocked} hours. Needs immediate attention.`},
              ${escalateTo},
              NOW()
            )
          `

          triggered.push({
            rule: 'blocked_24h',
            severity: 'critical',
            context,
            escalatedTo: escalateTo,
          })
        }
      }
    } catch (ruleErr) {
      console.error('escalation: blocked_24h error:', ruleErr.message)
    }

    // ── Rule 4: Underloaded users (< 30% workload for 5+ days) ─
    try {
      const underloaded = await sql`
        SELECT
          cs.user_id,
          cs.days_underloaded,
          cs.available_capacity_pct,
          du.display_name,
          du.team
        FROM capacity_status cs
        JOIN dashboard_users du ON du.id = cs.user_id
        WHERE cs.days_underloaded >= 5
          AND cs.available_capacity_pct > 70
          AND du.active = true
      `

      if (underloaded && underloaded.length > 0) {
        for (const row of underloaded) {
          const existing = await sql`
            SELECT id FROM escalation_log
            WHERE rule_triggered = 'capacity_underloaded'
              AND context->>'user_id' = ${String(row.user_id)}
              AND triggered_at >= CURRENT_DATE
            LIMIT 1
          `
          if (existing && existing.length > 0) continue

          const escalateTo = await findEscalationTarget(sql, row.team)

          const context = {
            user_id: String(row.user_id),
            display_name: row.display_name,
            team: row.team,
            days_underloaded: row.days_underloaded,
            available_capacity_pct: row.available_capacity_pct,
          }

          await sql`
            INSERT INTO escalation_log (
              rule_triggered, context, action_taken, escalated_to, triggered_at
            ) VALUES (
              'capacity_underloaded',
              ${JSON.stringify(context)}::jsonb,
              ${`${row.display_name} has been underloaded (${Math.round(row.available_capacity_pct)}% free) for ${row.days_underloaded} days. Consider reassigning tickets.`},
              ${escalateTo},
              NOW()
            )
          `

          triggered.push({
            rule: 'capacity_underloaded',
            severity: 'low',
            context,
            escalatedTo: escalateTo,
          })
        }
      }
    } catch (ruleErr) {
      console.error('escalation: capacity_underloaded error:', ruleErr.message)
    }
  } catch (err) {
    console.error('escalation.runEscalationEngine: error:', err.message)
  }

  return {
    triggered: triggered.length,
    escalations: triggered,
    rules: ESCALATION_RULES,
  }
}

// ────────────────────────────────────────────────────────────────
// findEscalationTarget — team_lead for the team, or any manager
// ────────────────────────────────────────────────────────────────
async function findEscalationTarget(sql, team) {
  if (!team) return null

  try {
    // Try team lead first
    const leadRows = await sql`
      SELECT id FROM dashboard_users
      WHERE team = ${team}
        AND role = 'team_lead'
        AND active = true
      LIMIT 1
    `
    if (leadRows && leadRows.length > 0) return leadRows[0].id

    // Fall back to any manager
    const managerRows = await sql`
      SELECT id FROM dashboard_users
      WHERE role = 'manager'
        AND active = true
      LIMIT 1
    `
    if (managerRows && managerRows.length > 0) return managerRows[0].id
  } catch (err) {
    console.error('escalation.findEscalationTarget: error:', err.message)
  }

  return null
}

// ────────────────────────────────────────────────────────────────
// getRecentEscalations — For dashboard display
// ────────────────────────────────────────────────────────────────
async function getRecentEscalations(limit = 20) {
  const sql = getDb()
  try {
    const rows = await sql`
      SELECT
        el.*,
        du.display_name AS escalated_to_name
      FROM escalation_log el
      LEFT JOIN dashboard_users du ON du.id = el.escalated_to
      ORDER BY el.triggered_at DESC
      LIMIT ${limit}
    `
    return rows || []
  } catch (err) {
    console.error('escalation.getRecentEscalations: error:', err.message)
    return []
  }
}

module.exports = {
  ESCALATION_RULES,
  runEscalationEngine,
  getRecentEscalations,
}
