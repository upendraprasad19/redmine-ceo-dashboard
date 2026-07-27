/**
 * intelligence/velocity.js
 * Velocity calculations and deadline-miss predictions.
 */

const { getDb } = require('../lib/db')

// ────────────────────────────────────────────────────────────────
// calculateVelocity — Tickets closed per week over N weeks
// Accepts either a team name (string) or a Redmine user id (number)
// ────────────────────────────────────────────────────────────────
async function calculateVelocity(teamOrUserId, periodWeeks = 4) {
  const sql = getDb()

  try {
    const isTeam = typeof teamOrUserId === 'string'
    const weeks = Math.max(1, Math.min(periodWeeks, 52)) // cap at 52

    let weeklyRows

    if (isTeam) {
      // Team velocity: count tickets closed per week for the entire team
      weeklyRows = await sql`
        SELECT
          DATE_TRUNC('week', i.closed_at)::date AS week_start,
          COUNT(*)::int AS closed
        FROM issues i
        JOIN users u ON u.id = i.assigned_to_id
        WHERE u.team = ${teamOrUserId}
          AND i.closed_at IS NOT NULL
          AND i.closed_at >= NOW() - (${weeks} || ' weeks')::interval
        GROUP BY week_start
        ORDER BY week_start ASC
      `
    } else {
      // Individual user velocity
      weeklyRows = await sql`
        SELECT
          DATE_TRUNC('week', i.closed_at)::date AS week_start,
          COUNT(*)::int AS closed
        FROM issues i
        WHERE i.assigned_to_id = ${teamOrUserId}
          AND i.closed_at IS NOT NULL
          AND i.closed_at >= NOW() - (${weeks} || ' weeks')::interval
        GROUP BY week_start
        ORDER BY week_start ASC
      `
    }

    if (!weeklyRows || weeklyRows.length === 0) {
      return {
        ticketsPerWeek: 0,
        weeklyBreakdown: [],
        trend: 'stable',
        direction: 'stable',
        weeks: 0,
      }
    }

    // Fill in missing weeks with 0
    const breakdown = []
    const startWeek = new Date(weeklyRows[0].week_start)
    const endWeek = new Date()
    const weekMap = {}
    for (const row of weeklyRows) {
      const key = new Date(row.week_start).toISOString().slice(0, 10)
      weekMap[key] = row.closed
    }

    const cursor = new Date(startWeek)
    while (cursor <= endWeek) {
      const key = cursor.toISOString().slice(0, 10)
      breakdown.push({
        weekStart: key,
        closed: weekMap[key] || 0,
      })
      cursor.setDate(cursor.getDate() + 7)
    }

    // Average tickets per week
    const totalClosed = breakdown.reduce((sum, w) => sum + w.closed, 0)
    const ticketsPerWeek = breakdown.length > 0 ? totalClosed / breakdown.length : 0

    // Determine trend: compare first half vs second half
    const mid = Math.floor(breakdown.length / 2)
    const firstHalf = breakdown.slice(0, mid)
    const secondHalf = breakdown.slice(mid)

    const firstAvg =
      firstHalf.length > 0 ? firstHalf.reduce((s, w) => s + w.closed, 0) / firstHalf.length : 0
    const secondAvg =
      secondHalf.length > 0 ? secondHalf.reduce((s, w) => s + w.closed, 0) / secondHalf.length : 0

    let trend = 'stable'
    let direction = 'stable'
    const diff = secondAvg - firstAvg
    if (diff > 0.5) {
      trend = 'accelerating'
      direction = 'accelerating'
    } else if (diff < -0.5) {
      trend = 'decelerating'
      direction = 'decelerating'
    }

    return {
      ticketsPerWeek: Math.round(ticketsPerWeek * 100) / 100,
      weeklyBreakdown: breakdown,
      trend,
      direction,
      weeks: breakdown.length,
    }
  } catch (err) {
    console.error('velocity.calculateVelocity: error:', err.message)
    return {
      ticketsPerWeek: 0,
      weeklyBreakdown: [],
      trend: 'stable',
      direction: 'stable',
      weeks: 0,
    }
  }
}

// ────────────────────────────────────────────────────────────────
// predictDeadlineMiss — Will a project miss its deadline?
// ────────────────────────────────────────────────────────────────
async function predictDeadlineMiss(projectId) {
  const sql = getDb()

  try {
    // 1. Get project info
    const projRows = await sql`
      SELECT id, name, deadline, progress_pct, status
      FROM projects
      WHERE id = ${projectId}
    `

    if (!projRows || projRows.length === 0) {
      return { error: 'Project not found', willMiss: null }
    }

    const project = projRows[0]

    if (!project.deadline) {
      return {
        projectName: project.name,
        willMiss: null,
        reason: 'No deadline set',
        confidence: 'low',
      }
    }

    // 2. Count remaining tickets (not closed / resolved)
    const remainingRows = await sql`
      SELECT COUNT(*)::int AS remaining
      FROM issues
      WHERE project_id = ${projectId}
        AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
    `
    const remaining = remainingRows?.[0]?.remaining || 0

    if (remaining === 0) {
      return {
        projectName: project.name,
        willMiss: false,
        byDays: 0,
        remaining: 0,
        confidence: 'high',
        reason: 'All tickets resolved',
      }
    }

    // 3. Get team members working on this project for velocity calc
    const teamRows = await sql`
      SELECT DISTINCT u.team
      FROM issues i
      JOIN users u ON u.id = i.assigned_to_id
      WHERE i.project_id = ${projectId}
        AND u.team IS NOT NULL
      LIMIT 1
    `
    const teamName = teamRows?.[0] ? teamRows[0].team : null

    // 4. Compute project-specific velocity (tickets closed per week on this project)
    const velRows = await sql`
      SELECT COUNT(*)::float AS closed_4w
      FROM issues
      WHERE project_id = ${projectId}
        AND closed_at IS NOT NULL
        AND closed_at >= NOW() - INTERVAL '4 weeks'
    `
    const closed4w = velRows?.[0]?.closed_4w || 0
    const velocityPerWeek = closed4w / 4

    // 5. Calculate time needed
    const deadline = new Date(project.deadline)
    const now = new Date()
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    const weeksUntilDeadline = Math.max(0, (deadline - now) / msPerWeek)

    let willMiss = false
    let byDays = 0
    let confidence = 'medium'

    if (velocityPerWeek <= 0) {
      // No velocity data — cannot predict
      willMiss = remaining > 0 && weeksUntilDeadline < 2
      confidence = 'low'
      byDays = willMiss ? Math.ceil(remaining * 7) : 0 // very rough
    } else {
      const weeksNeeded = remaining / velocityPerWeek
      willMiss = weeksNeeded > weeksUntilDeadline
      byDays = willMiss ? Math.ceil((weeksNeeded - weeksUntilDeadline) * 7) : 0

      // Confidence based on data quality
      if (closed4w >= 8) confidence = 'high'
      else if (closed4w >= 3) confidence = 'medium'
      else confidence = 'low'
    }

    // If using team velocity as fallback
    let teamVelocity = null
    if (teamName && velocityPerWeek <= 0) {
      const tv = await calculateVelocity(teamName, 4)
      teamVelocity = tv.ticketsPerWeek
      if (teamVelocity > 0) {
        const weeksNeeded = remaining / teamVelocity
        willMiss = weeksNeeded > weeksUntilDeadline
        byDays = willMiss ? Math.ceil((weeksNeeded - weeksUntilDeadline) * 7) : 0
        confidence = 'low' // team-level fallback is less precise
      }
    }

    return {
      projectName: project.name,
      deadline: project.deadline,
      remaining,
      velocityPerWeek: Math.round(velocityPerWeek * 100) / 100,
      teamVelocity,
      weeksUntilDeadline: Math.round(weeksUntilDeadline * 100) / 100,
      willMiss,
      byDays,
      confidence,
    }
  } catch (err) {
    console.error('velocity.predictDeadlineMiss: error:', err.message)
    return { error: err.message, willMiss: null }
  }
}

module.exports = {
  calculateVelocity,
  predictDeadlineMiss,
}
