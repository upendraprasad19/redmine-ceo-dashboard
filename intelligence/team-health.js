/**
 * intelligence/team-health.js
 * Composite team health scoring: on-time delivery, consistency, blockers, reopen rate.
 */

const { getDb } = require('../lib/db')

// ────────────────────────────────────────────────────────────────
// computeTeamHealthScores — Weekly health metrics per team
// ────────────────────────────────────────────────────────────────
async function computeTeamHealthScores() {
  const sql = getDb()
  const results = []

  try {
    // Determine current week start (Monday)
    const now = new Date()
    const day = now.getDay()
    const diff = day === 0 ? 6 : day - 1 // Monday = 0
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - diff)
    const weekStartStr = weekStart.toISOString().slice(0, 10)

    // Previous week for trend comparison
    const prevWeekStart = new Date(weekStart)
    prevWeekStart.setDate(prevWeekStart.getDate() - 7)
    const prevWeekStartStr = prevWeekStart.toISOString().slice(0, 10)

    // Get all teams
    const teams = await sql`
      SELECT DISTINCT team
      FROM users
      WHERE team IS NOT NULL AND active = true
    `

    if (!teams || teams.length === 0) return results

    for (const teamRow of teams) {
      try {
        const team = teamRow.team

        // Get team member IDs
        const members = await sql`
          SELECT id FROM users WHERE team = ${team} AND active = true
        `
        if (!members || members.length === 0) continue
        const memberIds = members.map((m) => m.id)

        // ── 1. On-time delivery rate ────────────────────────────
        const deliveryRows = await sql`
          SELECT
            COUNT(*) FILTER (
              WHERE closed_at IS NOT NULL
              AND due_date IS NOT NULL
              AND closed_at <= due_date::timestamptz
            )::float AS on_time,
            COUNT(*) FILTER (
              WHERE closed_at IS NOT NULL
              AND due_date IS NOT NULL
            )::float AS total_with_deadline,
            COUNT(*) FILTER (
              WHERE closed_at IS NOT NULL
              AND closed_at >= ${weekStartStr}::date
            )::float AS total_closed
          FROM issues
          WHERE assigned_to_id = ANY(${memberIds})
            AND closed_at >= ${weekStartStr}::date
        `
        const dr = deliveryRows?.[0] || {}
        const onTimeDR = dr.total_with_deadline > 0 ? dr.on_time / dr.total_with_deadline : 0

        // ── 2. Hours consistency (lower stddev = more consistent) ──
        const hoursRows = await sql`
          SELECT
            spent_on,
            SUM(hours)::float AS daily_hours
          FROM time_entries
          WHERE user_id = ANY(${memberIds})
            AND spent_on >= ${weekStartStr}::date
          GROUP BY spent_on
          ORDER BY spent_on
        `

        let hoursConsistency = 0
        if (hoursRows && hoursRows.length > 1) {
          const dailyHours = hoursRows.map((r) => r.daily_hours || 0)
          const mean = dailyHours.reduce((a, b) => a + b, 0) / dailyHours.length
          const variance =
            dailyHours.reduce((sum, val) => sum + (val - mean) ** 2, 0) / dailyHours.length
          const stddev = Math.sqrt(variance)
          // Normalise: stddev of 0 = 1.0 (perfect), stddev >= 4 = 0
          hoursConsistency = Math.max(0, Math.min(1, 1 - stddev / 4))
        } else if (hoursRows && hoursRows.length === 1) {
          hoursConsistency = 0.8 // single data point
        }

        // ── 3. Blocker resolution speed (avg hours) ─────────────
        // Estimate: time a ticket was in "Blocked" status
        // Using issue_journals to find transitions
        const blockerRows = await sql`
          SELECT
            AVG(
              EXTRACT(EPOCH FROM (
                COALESCE(
                  (SELECT MIN(ij2.created_at)
                   FROM issue_journals ij2
                   WHERE ij2.issue_id = i.id
                     AND ij2.created_at > ij.created_at
                  ),
                  NOW()
                ) - ij.created_at
              )) / 3600
            )::float AS avg_blocker_hours
          FROM issue_journals ij
          JOIN issues i ON i.id = ij.issue_id
          WHERE i.assigned_to_id = ANY(${memberIds})
            AND ij.created_at >= ${weekStartStr}::date
            AND ij.notes ILIKE '%block%'
        `
        const avgBlockerHours = blockerRows?.[0]?.avg_blocker_hours
          ? parseFloat(blockerRows[0].avg_blocker_hours)
          : 0

        // ── 4. Reopen rate ──────────────────────────────────────
        const reopenRows = await sql`
          SELECT
            COUNT(*) FILTER (
              WHERE status IN ('Reopened')
              OR (status = 'In Progress' AND done_ratio < 100 AND closed_at IS NOT NULL)
            )::float AS reopened,
            COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::float AS total_closed
          FROM issues
          WHERE assigned_to_id = ANY(${memberIds})
            AND (closed_at >= ${weekStartStr}::date OR status = 'Reopened')
        `
        const rr = reopenRows?.[0] || {}
        const reopenRate = rr.total_closed > 0 ? (rr.reopened || 0) / rr.total_closed : 0

        // ── 5. Overall composite score (0-100) ──────────────────
        // Weights: on_time 35%, consistency 20%, blocker_speed 25%, reopen_rate 20%
        const blockerScore =
          avgBlockerHours <= 0
            ? 80 // no blockers = good
            : Math.max(0, Math.min(100, 100 - avgBlockerHours * 2))
        const reopenScore = Math.max(0, Math.min(100, (1 - reopenRate) * 100))

        const overallScore = Math.round(
          onTimeDR * 100 * 0.35 +
            hoursConsistency * 100 * 0.2 +
            blockerScore * 0.25 +
            reopenScore * 0.2,
        )

        // ── 6. Trend: compare to last week ──────────────────────
        const prevRows = await sql`
          SELECT overall_score
          FROM team_health
          WHERE team = ${team}
            AND week_start = ${prevWeekStartStr}::date
          LIMIT 1
        `
        const prevScore = prevRows?.[0] ? prevRows[0].overall_score : null
        let trend = 'stable'
        if (prevScore !== null) {
          const delta = overallScore - prevScore
          if (delta >= 5) trend = 'rising'
          else if (delta <= -5) trend = 'declining'
        }

        // ── 7. Upsert ──────────────────────────────────────────
        const rawData = {
          on_time_delivery_raw: onTimeDR,
          hours_consistency_raw: hoursConsistency,
          avg_blocker_hours: avgBlockerHours,
          reopen_rate_raw: reopenRate,
          member_count: memberIds.length,
          total_closed: dr.total_closed || 0,
        }

        await sql`
          INSERT INTO team_health (
            team, week_start,
            on_time_delivery_rate, hours_consistency,
            blocker_resolution_speed, reopen_rate,
            overall_score, trend, raw_data, created_at
          ) VALUES (
            ${team}, ${weekStartStr}::date,
            ${onTimeDR}, ${hoursConsistency},
            ${avgBlockerHours}, ${reopenRate},
            ${overallScore}, ${trend},
            ${JSON.stringify(rawData)}::jsonb, NOW()
          )
          ON CONFLICT (team, week_start)
          DO UPDATE SET
            on_time_delivery_rate = EXCLUDED.on_time_delivery_rate,
            hours_consistency = EXCLUDED.hours_consistency,
            blocker_resolution_speed = EXCLUDED.blocker_resolution_speed,
            reopen_rate = EXCLUDED.reopen_rate,
            overall_score = EXCLUDED.overall_score,
            trend = EXCLUDED.trend,
            raw_data = EXCLUDED.raw_data,
            created_at = NOW()
        `

        results.push({
          team,
          overallScore,
          trend,
          onTimeDeliveryRate: Math.round(onTimeDR * 100),
          reopenRate: Math.round(reopenRate * 100),
        })
      } catch (teamErr) {
        console.error(`team-health: error for team ${teamRow.team}:`, teamErr.message)
      }
    }
  } catch (err) {
    console.error('team-health.computeTeamHealthScores: error:', err.message)
  }

  return results
}

// ────────────────────────────────────────────────────────────────
// getTeamHealth — Latest health row for a single team
// ────────────────────────────────────────────────────────────────
async function getTeamHealth(team) {
  const sql = getDb()
  try {
    const rows = await sql`
      SELECT *
      FROM team_health
      WHERE team = ${team}
      ORDER BY week_start DESC
      LIMIT 1
    `
    return rows?.[0] || null
  } catch (err) {
    console.error('team-health.getTeamHealth: error:', err.message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────
// getAllTeamHealth — Latest health rows for all teams
// ────────────────────────────────────────────────────────────────
async function getAllTeamHealth() {
  const sql = getDb()
  try {
    const rows = await sql`
      SELECT DISTINCT ON (team) *
      FROM team_health
      ORDER BY team, week_start DESC
    `
    return rows || []
  } catch (err) {
    console.error('team-health.getAllTeamHealth: error:', err.message)
    return []
  }
}

module.exports = {
  computeTeamHealthScores,
  getTeamHealth,
  getAllTeamHealth,
}
