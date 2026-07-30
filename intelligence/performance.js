/**
 * intelligence/performance.js
 * 5-dimension scoring engine: output, speed, quality, reliability, collaboration.
 */

const { getDb } = require('../lib/db')

// Score weights
const WEIGHTS = {
  output: 0.25,
  speed: 0.2,
  quality: 0.2,
  reliability: 0.2,
  collaboration: 0.15,
}

// ────────────────────────────────────────────────────────────────
// calculatePerformanceScores — Compute and store scores for all users
// ────────────────────────────────────────────────────────────────
async function calculatePerformanceScores(period = 'daily') {
  const sql = getDb()
  const results = []

  try {
    // Determine date range based on period
    const { startDate, prevStart, prevEnd } = getPeriodDates(period)

    // Get all active users (performance uses users.id directly)
    const allUsers = await sql`
      SELECT id, team
      FROM users
      WHERE active = true
    `

    if (!allUsers || allUsers.length === 0) return results

    // Fetch global averages for normalisation
    const avgRows = await sql`
      SELECT
        COALESCE(AVG(closed_count), 0)::float AS avg_closed,
        COALESCE(AVG(resolution_hrs), 0)::float AS avg_resolution
      FROM (
        SELECT
          assigned_to_id,
          COUNT(*) FILTER (WHERE closed_at >= ${startDate}) AS closed_count,
          AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600)
            FILTER (WHERE closed_at >= ${startDate} AND closed_at IS NOT NULL) AS resolution_hrs
        FROM issues
        WHERE assigned_to_id IS NOT NULL
        GROUP BY assigned_to_id
      ) sub
    `
    const avgClosed = avgRows?.[0]?.avg_closed || 1
    const avgResolution = avgRows?.[0]?.avg_resolution || 24

    for (const user of allUsers) {
      try {
        const uid = user.id

        // ── Gather raw metrics ──────────────────────────────────
        const metrics = await sql`
          SELECT
            COUNT(*) FILTER (WHERE i.closed_at >= ${startDate})::int AS tickets_closed,
            COUNT(*) FILTER (WHERE i.status = 'In Progress')::int AS tickets_in_progress,
            COUNT(*) FILTER (
              WHERE i.due_date < NOW()
              AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
            )::int AS tickets_overdue,
            COUNT(*) FILTER (WHERE i.status = 'Reopened' OR (i.status = 'In Progress' AND i.done_ratio < 100 AND i.closed_at IS NOT NULL))::int AS tickets_reopened,
            AVG(EXTRACT(EPOCH FROM (i.closed_at - i.created_at)) / 3600)
              FILTER (WHERE i.closed_at >= ${startDate} AND i.closed_at IS NOT NULL)
              AS avg_resolution_hrs,
            COUNT(*) FILTER (
              WHERE i.closed_at IS NOT NULL
              AND i.closed_at >= ${startDate}
              AND i.due_date IS NOT NULL
              AND i.closed_at <= i.due_date::timestamptz
            )::int AS on_time_count,
            COUNT(*) FILTER (
              WHERE i.closed_at IS NOT NULL
              AND i.closed_at >= ${startDate}
              AND i.due_date IS NOT NULL
            )::int AS with_deadline_count
          FROM issues i
          WHERE i.assigned_to_id = ${uid}
        `

        const m = metrics?.[0] || {}
        const ticketsClosed = m.tickets_closed || 0
        const ticketsInProgress = m.tickets_in_progress || 0
        const ticketsOverdue = m.tickets_overdue || 0
        const ticketsReopened = m.tickets_reopened || 0
        const avgResolutionHrs = m.avg_resolution_hrs ? parseFloat(m.avg_resolution_hrs) : null
        const onTimeCount = m.on_time_count || 0
        const withDeadlineCount = m.with_deadline_count || 0

        // Hours logged in period
        const hoursRows = await sql`
          SELECT COALESCE(SUM(hours), 0)::float AS total_hours
          FROM time_entries
          WHERE user_id = ${uid}
            AND spent_on >= ${startDate}
        `
        const hoursLogged = hoursRows?.[0]?.total_hours || 0

        // Blockers resolved for others (collaboration metric)
        // Count journals where this user commented on tickets assigned to someone else
        const collabRows = await sql`
          SELECT COUNT(DISTINCT ij.issue_id)::int AS blockers_helped
          FROM issue_journals ij
          JOIN issues i ON i.id = ij.issue_id
          WHERE ij.author_id = ${uid}
            AND i.assigned_to_id != ${uid}
            AND ij.created_at >= ${startDate}
            AND ij.notes IS NOT NULL
            AND ij.notes != ''
        `
        const blockersHelped = collabRows?.[0]?.blockers_helped || 0

        // ── Compute 5 scores (0-100) ────────────────────────────
        // Output: how many tickets closed relative to average
        const outputScore = clamp(
          Math.round((ticketsClosed / Math.max(avgClosed, 1)) * 60 + (hoursLogged > 0 ? 20 : 0)),
          0,
          100,
        )

        // Speed: based on resolution time (lower is better)
        let speedScore = 50 // default
        if (avgResolutionHrs !== null && avgResolution > 0) {
          speedScore = clamp(Math.round(100 - (avgResolutionHrs / avgResolution) * 50), 0, 100)
        } else if (ticketsClosed > 0) {
          speedScore = 60 // closed tickets but no resolution time data
        }

        // Quality: based on reopen rate (lower is better)
        const totalResolved = ticketsClosed + ticketsReopened
        const reopenRate = totalResolved > 0 ? ticketsReopened / totalResolved : 0
        const qualityScore = clamp(Math.round((1 - reopenRate) * 100), 0, 100)

        // Reliability: based on deadline hit rate
        const deadlineHitRate = withDeadlineCount > 0 ? onTimeCount / withDeadlineCount : 0
        let reliabilityScore = clamp(Math.round(deadlineHitRate * 100), 0, 100)
        // Penalise for overdue tickets
        if (ticketsOverdue > 0) {
          reliabilityScore = clamp(reliabilityScore - ticketsOverdue * 5, 0, 100)
        }

        // Collaboration: based on how much they help others
        const collaborationScore = clamp(Math.min(blockersHelped * 15 + 20, 100), 0, 100)

        // Overall: weighted average
        const overallScore = Math.round(
          outputScore * WEIGHTS.output +
            speedScore * WEIGHTS.speed +
            qualityScore * WEIGHTS.quality +
            reliabilityScore * WEIGHTS.reliability +
            collaborationScore * WEIGHTS.collaboration,
        )

        // ── Trend: compare to previous period ───────────────────
        const prevRows = await sql`
          SELECT overall_score
          FROM performance_snapshots
          WHERE user_id = ${uid}
            AND period = ${period}
            AND snapshot_date >= ${prevStart}
            AND snapshot_date <= ${prevEnd}
          ORDER BY snapshot_date DESC
          LIMIT 1
        `
        const prevScore = prevRows?.[0] ? prevRows[0].overall_score : null
        const scoreDelta = prevScore !== null ? overallScore - prevScore : 0
        let trend = 'stable'
        if (scoreDelta >= 5) trend = 'rising'
        else if (scoreDelta <= -5) trend = 'declining'

        // ── Upsert into performance_snapshots ───────────────────
        const today = new Date().toISOString().slice(0, 10)
        const rawData = {
          tickets_closed: ticketsClosed,
          tickets_in_progress: ticketsInProgress,
          tickets_overdue: ticketsOverdue,
          tickets_reopened: ticketsReopened,
          hours_logged: hoursLogged,
          avg_resolution_hrs: avgResolutionHrs,
          deadline_hit_rate: deadlineHitRate,
          reopen_rate: reopenRate,
          blockers_helped: blockersHelped,
        }

        await sql`
          INSERT INTO performance_snapshots (
            user_id, snapshot_date, period,
            tickets_closed, tickets_in_progress, tickets_overdue, tickets_reopened,
            hours_logged, avg_resolution_time_hrs, reopen_rate, deadline_hit_rate,
            output_score, speed_score, quality_score, reliability_score, collaboration_score,
            overall_score, score_delta, trend, raw_data, created_at
          ) VALUES (
            ${uid}, ${today}, ${period},
            ${ticketsClosed}, ${ticketsInProgress}, ${ticketsOverdue}, ${ticketsReopened},
            ${hoursLogged}, ${avgResolutionHrs}, ${reopenRate}, ${deadlineHitRate},
            ${outputScore}, ${speedScore}, ${qualityScore}, ${reliabilityScore}, ${collaborationScore},
            ${overallScore}, ${scoreDelta}, ${trend}, ${JSON.stringify(rawData)}::jsonb, NOW()
          )
          ON CONFLICT (user_id, snapshot_date, period)
          DO UPDATE SET
            tickets_closed = EXCLUDED.tickets_closed,
            tickets_in_progress = EXCLUDED.tickets_in_progress,
            tickets_overdue = EXCLUDED.tickets_overdue,
            tickets_reopened = EXCLUDED.tickets_reopened,
            hours_logged = EXCLUDED.hours_logged,
            avg_resolution_time_hrs = EXCLUDED.avg_resolution_time_hrs,
            reopen_rate = EXCLUDED.reopen_rate,
            deadline_hit_rate = EXCLUDED.deadline_hit_rate,
            output_score = EXCLUDED.output_score,
            speed_score = EXCLUDED.speed_score,
            quality_score = EXCLUDED.quality_score,
            reliability_score = EXCLUDED.reliability_score,
            collaboration_score = EXCLUDED.collaboration_score,
            overall_score = EXCLUDED.overall_score,
            score_delta = EXCLUDED.score_delta,
            trend = EXCLUDED.trend,
            raw_data = EXCLUDED.raw_data,
            created_at = NOW()
        `

        results.push({
          userId: uid,
          overallScore,
          trend,
          delta: scoreDelta,
        })
      } catch (userErr) {
        console.error(`performance: error for user ${user.id}:`, userErr.message)
      }
    }
  } catch (err) {
    console.error('performance.calculatePerformanceScores: error:', err.message)
  }

  return results
}

// ────────────────────────────────────────────────────────────────
// getPerformanceForUser — Fetch the latest snapshot for a user
// ────────────────────────────────────────────────────────────────
async function getPerformanceForUser(userId, period = 'daily') {
  const sql = getDb()
  try {
    const rows = await sql`
      SELECT *
      FROM performance_snapshots
      WHERE user_id = ${userId}
        AND period = ${period}
      ORDER BY snapshot_date DESC
      LIMIT 1
    `
    return rows?.[0] || null
  } catch (err) {
    console.error('performance.getPerformanceForUser: error:', err.message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────
// getTeamPerformance — All team members' latest snapshots
// ────────────────────────────────────────────────────────────────
async function getTeamPerformance(team, period = 'daily') {
  const sql = getDb()
  try {
    const rows = await sql`
      SELECT ps.*
      FROM performance_snapshots ps
      JOIN users u ON u.id = ps.user_id
      WHERE u.team = ${team}
        AND ps.period = ${period}
        AND ps.snapshot_date = (
          SELECT MAX(snapshot_date)
          FROM performance_snapshots
          WHERE user_id = ps.user_id AND period = ${period}
        )
      ORDER BY ps.overall_score DESC
    `
    return rows || []
  } catch (err) {
    console.error('performance.getTeamPerformance: error:', err.message)
    return []
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

function getPeriodDates(period) {
  const now = new Date()
  let startDate, prevStart, prevEnd

  if (period === 'weekly') {
    startDate = new Date(now)
    startDate.setDate(startDate.getDate() - 7)
    prevEnd = new Date(startDate)
    prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - 7)
  } else if (period === 'monthly') {
    startDate = new Date(now)
    startDate.setMonth(startDate.getMonth() - 1)
    prevEnd = new Date(startDate)
    prevStart = new Date(prevEnd)
    prevStart.setMonth(prevStart.getMonth() - 1)
  } else {
    // daily — today
    startDate = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
    prevEnd = new Date(startDate)
    prevEnd.setDate(prevEnd.getDate() - 1)
    prevStart = new Date(`${prevEnd.toISOString().slice(0, 10)}T00:00:00Z`)
  }

  return {
    startDate: startDate.toISOString(),
    prevStart: prevStart.toISOString().slice(0, 10),
    prevEnd: prevEnd.toISOString().slice(0, 10),
  }
}

module.exports = {
  calculatePerformanceScores,
  getPerformanceForUser,
  getTeamPerformance,
}
