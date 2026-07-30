import { send500 } from '../../../../lib/api-error'
import { getCurrentUser } from '../../../../lib/auth'
import { getDb } from '../../../../lib/db'

const VALID_PERIODS = ['daily', 'weekly', 'monthly']

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const { id } = req.query
    const userId = parseInt(id, 10)
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' })

    const period = req.query.period || 'daily'
    if (!VALID_PERIODS.includes(period)) {
      return res.status(400).json({ error: `Supported periods: ${VALID_PERIODS.join(', ')}` })
    }

    const sql = getDb()

    // ── Phase 1: Identity + authorization + ID resolution ──────────
    const personRows = await sql`
      SELECT id, name, team, role, initials
      FROM users WHERE id = ${userId} AND active = true LIMIT 1
    `
    if (personRows.length === 0) {
      return res.status(404).json({ error: 'Person not found' })
    }
    const person = personRows[0]

    // Team-scoping: team_lead can only view own team
    if (user.role === 'team_lead' && user.team !== person.team) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Leave status
    const leaveRows = await sql`
      SELECT leave_type FROM leave_records
      WHERE user_id = ${userId}
        AND CURRENT_DATE BETWEEN start_date AND end_date
      LIMIT 1
    `
    const leave = leaveRows.length > 0 ? leaveRows[0].leave_type : null

    // Resolve dashboard_users.id for performance/commitment/capacity queries
    const dashUserRows = await sql`
      SELECT id AS dashboard_user_id FROM dashboard_users
      WHERE linked_redmine_user_id = ${userId}
      LIMIT 1
    `
    const dashboardUserId = dashUserRows.length > 0 ? dashUserRows[0].dashboard_user_id : null

    // ── Phase 2: All parallel queries ──────────────────────────────
    const promises = []

    // 4. Performance snapshot (uses users.id directly — no dashboard_users needed)
    promises.push(
      sql`
        SELECT * FROM performance_snapshots
        WHERE user_id = ${userId} AND period = ${period}
        ORDER BY snapshot_date DESC LIMIT 1
      `.then((rows) => ({ key: 'performance', data: rows[0] || null })),
    )

    // 5. Velocity (tickets closed per week, last 8 weeks)
    promises.push(
      sql`
        SELECT DATE_TRUNC('week', closed_at)::date AS week_start,
               COUNT(*)::int AS closed
        FROM issues
        WHERE assigned_to_id = ${userId}
          AND closed_at IS NOT NULL
          AND closed_at >= NOW() - INTERVAL '8 weeks'
        GROUP BY week_start
        ORDER BY week_start
      `.then((rows) => {
        // Gap-fill missing weeks
        const weekMap = {}
        for (const r of rows) {
          const key = new Date(r.week_start).toISOString().slice(0, 10)
          weekMap[key] = r.closed
        }
        const breakdown = []
        const now = new Date()
        const startWeek = rows.length > 0 ? new Date(rows[0].week_start) : new Date(now)
        if (rows.length === 0) startWeek.setDate(startWeek.getDate() - 56)
        const cursor = new Date(startWeek)
        while (cursor <= now) {
          const key = cursor.toISOString().slice(0, 10)
          breakdown.push({ week_start: key, closed: weekMap[key] || 0 })
          cursor.setDate(cursor.getDate() + 7)
        }
        const total = breakdown.reduce((s, w) => s + w.closed, 0)
        const ticketsPerWeek = breakdown.length > 0 ? total / breakdown.length : 0
        // Trend: compare first half vs second half
        const mid = Math.floor(breakdown.length / 2)
        const firstAvg =
          breakdown.slice(0, mid).reduce((s, w) => s + w.closed, 0) / Math.max(mid, 1)
        const secondAvg =
          breakdown.slice(mid).reduce((s, w) => s + w.closed, 0) /
          Math.max(breakdown.length - mid, 1)
        let trend = 'stable'
        if (secondAvg - firstAvg > 0.5) trend = 'accelerating'
        else if (secondAvg - firstAvg < -0.5) trend = 'decelerating'
        return {
          key: 'velocity',
          data: {
            tickets_per_week: Math.round(ticketsPerWeek * 100) / 100,
            trend,
            weekly_breakdown: breakdown,
          },
        }
      }),
    )

    // 6. Workload: active ticket count
    promises.push(
      sql`
        SELECT COUNT(*)::int AS active_tickets
        FROM issues
        WHERE assigned_to_id = ${userId}
          AND status NOT IN ('Closed','Resolved','Verified','Rejected')
      `.then((rows) => ({ key: 'active_tickets', data: rows[0]?.active_tickets || 0 })),
    )

    // 7. Workload detail (overdue, due_soon, high_priority, age)
    promises.push(
      sql`
        SELECT
          SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE THEN 1 ELSE 0 END)::int AS overdue,
          SUM(CASE WHEN due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3 THEN 1 ELSE 0 END)::int AS due_soon,
          SUM(CASE WHEN priority IN ('High','Critical') THEN 1 ELSE 0 END)::int AS high_priority,
          ROUND(AVG(CURRENT_DATE - created_at::date))::int AS avg_age_days,
          MAX(CURRENT_DATE - created_at::date)::int AS max_age_days,
          SUM(CASE WHEN created_at < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS tickets_7plus,
          SUM(CASE WHEN created_at < NOW() - INTERVAL '15 days' THEN 1 ELSE 0 END)::int AS tickets_15plus
        FROM issues
        WHERE assigned_to_id = ${userId}
          AND status NOT IN ('Closed','Resolved','Verified','Rejected')
      `.then((rows) => ({ key: 'workload_detail', data: rows[0] || {} })),
    )

    // 8. Capacity status
    if (dashboardUserId) {
      promises.push(
        sql`
          SELECT current_workload_pct, available_capacity_pct, predicted_free_date
          FROM capacity_status
          WHERE user_id = ${dashboardUserId}
        `.then((rows) => ({ key: 'capacity', data: rows[0] || null })),
      )
    } else {
      promises.push(Promise.resolve({ key: 'capacity', data: null }))
    }

    // 9. Time logging (month)
    promises.push(
      sql`
        SELECT COALESCE(SUM(hours), 0)::float AS hours_this_month,
               COUNT(DISTINCT spent_on)::int AS days_logged
        FROM time_entries
        WHERE user_id = ${userId}
          AND spent_on >= date_trunc('month', CURRENT_DATE)
      `.then((rows) => ({
        key: 'time_month',
        data: rows[0] || { hours_this_month: 0, days_logged: 0 },
      })),
    )

    // 10. Time logging (recent)
    promises.push(
      sql`
        SELECT COALESCE(SUM(hours), 0)::float AS hours_last_7days,
               MAX(spent_on) AS last_log_date,
               (CURRENT_DATE - MAX(spent_on))::int AS days_since_last_log
        FROM time_entries
        WHERE user_id = ${userId}
          AND spent_on >= CURRENT_DATE - 7
      `.then((rows) => ({
        key: 'time_recent',
        data: rows[0] || { hours_last_7days: 0, last_log_date: null, days_since_last_log: null },
      })),
    )

    // 11. Commitments
    if (dashboardUserId) {
      promises.push(
        sql`
          SELECT status, COUNT(*)::int AS count
          FROM commitments
          WHERE user_id = ${dashboardUserId}
          GROUP BY status
        `.then((rows) => {
          const counts = { pending: 0, kept: 0, missed: 0, followed_up: 0 }
          for (const r of rows) counts[r.status] = r.count
          const total = counts.kept + counts.missed
          return {
            key: 'commitments',
            data: {
              total,
              kept: counts.kept,
              missed: counts.missed,
              kept_rate: total > 0 ? Math.round((counts.kept / total) * 100) : null,
            },
          }
        }),
      )
    } else {
      promises.push(
        Promise.resolve({
          key: 'commitments',
          data: { total: 0, kept: 0, missed: 0, kept_rate: null },
        }),
      )
    }

    // 12. Team health
    promises.push(
      sql`
        SELECT overall_score, reopen_rate, on_time_delivery_rate
        FROM team_health
        WHERE team = ${person.team}
        ORDER BY week_start DESC LIMIT 1
      `.then((rows) => ({ key: 'team_health', data: rows[0] || null })),
    )

    // 13. Team average performance score
    promises.push(
      sql`
        SELECT AVG(ps.overall_score)::float AS team_avg
        FROM performance_snapshots ps
        JOIN users u ON u.id = ps.user_id
        WHERE u.team = ${person.team}
          AND ps.period = ${period}
          AND ps.snapshot_date = (
            SELECT MAX(ps2.snapshot_date)
            FROM performance_snapshots ps2
            WHERE ps2.user_id = ps.user_id AND ps2.period = ${period}
          )
      `.then((rows) => ({ key: 'team_avg', data: rows[0]?.team_avg || null })),
    )

    const results = await Promise.all(promises)
    const byKey = {}
    for (const r of results) byKey[r.key] = r.data

    // ── Assemble response ──────────────────────────────────────────
    const perf = byKey.performance
    const workloadActive = byKey.active_tickets
    const workloadDetail = byKey.workload_detail
    const cap = byKey.capacity
    const timeMonth = byKey.time_month
    const timeRecent = byKey.time_recent

    const totalWorkingDays = (() => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      let count = 0
      const d = new Date(start)
      while (d <= now) {
        const day = d.getDay()
        if (day !== 0 && day !== 6) count++
        d.setDate(d.getDate() + 1)
      }
      return count
    })()

    const daysLogged = timeMonth?.days_logged || 0
    const loggingStatus =
      (timeRecent?.hours_last_7days || 0) === 0
        ? 'No Log This Week'
        : (timeRecent?.days_since_last_log ?? 99) >= 3
          ? 'No Log in 3+ Days'
          : 'Logged Recently'

    const response = {
      person: { ...person, leave },
      performance: perf
        ? {
            overall_score: perf.overall_score,
            trend: perf.trend,
            score_delta: perf.score_delta,
            output_score: perf.output_score,
            speed_score: perf.speed_score,
            quality_score: perf.quality_score,
            reliability_score: perf.reliability_score,
            collaboration_score: perf.collaboration_score,
            tickets_closed: perf.tickets_closed,
            tickets_in_progress: perf.tickets_in_progress,
            tickets_overdue: perf.tickets_overdue,
            tickets_reopened: perf.tickets_reopened,
            hours_logged: perf.hours_logged,
            avg_resolution_time_hrs: perf.avg_resolution_time_hrs,
            reopen_rate: perf.reopen_rate,
            deadline_hit_rate: perf.deadline_hit_rate,
            blockers_helped: parseInt(perf.raw_data?.blockers_helped || 0),
          }
        : null,
      velocity: byKey.velocity,
      workload: {
        active_tickets: workloadActive,
        workload_pct: cap?.current_workload_pct ?? Math.min((workloadActive / 10) * 100, 100),
        available_capacity_pct:
          cap?.available_capacity_pct ??
          Math.max(100 - Math.min((workloadActive / 10) * 100, 100), 0),
        predicted_free_date: cap?.predicted_free_date ?? null,
        overdue: workloadDetail?.overdue ?? 0,
        due_soon: workloadDetail?.due_soon ?? 0,
        high_priority: workloadDetail?.high_priority ?? 0,
        avg_age_days: workloadDetail?.avg_age_days ?? 0,
        max_age_days: workloadDetail?.max_age_days ?? 0,
        tickets_7plus: workloadDetail?.tickets_7plus ?? 0,
        tickets_15plus: workloadDetail?.tickets_15plus ?? 0,
      },
      time_logging: {
        hours_this_month: timeMonth?.hours_this_month || 0,
        hours_last_7days: timeRecent?.hours_last_7days || 0,
        days_logged_this_month: daysLogged,
        total_working_days_month: totalWorkingDays,
        logging_status: loggingStatus,
        last_log_date: timeRecent?.last_log_date ?? null,
        days_since_last_log: timeRecent?.days_since_last_log ?? null,
      },
      commitments: byKey.commitments,
      team_context: {
        team_overall_score: byKey.team_health?.overall_score ?? null,
        team_reopen_rate: byKey.team_health?.reopen_rate ?? null,
        team_on_time_delivery: byKey.team_health?.on_time_delivery_rate ?? null,
        individual_vs_team:
          perf && byKey.team_avg != null
            ? {
                score_diff: Math.round(perf.overall_score - byKey.team_avg),
                is_above_average: perf.overall_score > byKey.team_avg,
              }
            : null,
      },
    }

    res.status(200).json(response)
  } catch (err) {
    send500(res, err, 'people-profile')
  }
}
