/**
 * intelligence/insights.js
 * AI-powered insight generation: proactive alerts and pinned insights for the dashboard.
 */

const { getDb } = require('../lib/db');

// ────────────────────────────────────────────────────────────────
// generateInsightsForUser — Generate and pin insights for one user
// ────────────────────────────────────────────────────────────────
async function generateInsightsForUser(userId) {
  const sql = getDb();
  const generated = [];

  try {
    // Get user info
    const userRows = await sql`
      SELECT id, role, team, display_name, linked_redmine_user_id
      FROM dashboard_users
      WHERE id = ${userId} AND active = true
    `;
    if (!userRows || userRows.length === 0) return generated;

    const user = userRows[0];
    const isManager = user.role === 'manager';

    // Determine scope: managers see all, team_leads see their team
    let teamFilter;
    if (isManager) {
      const teamRows = await sql`
        SELECT DISTINCT team FROM users WHERE team IS NOT NULL AND active = true
      `;
      teamFilter = teamRows ? teamRows.map((r) => r.team) : [];
    } else {
      teamFilter = user.team ? [user.team] : [];
    }

    if (teamFilter.length === 0) return generated;

    // Get member IDs for the teams in scope
    const memberRows = await sql`
      SELECT id, name, team FROM users
      WHERE team = ANY(${teamFilter}) AND active = true
    `;
    const memberIds = memberRows ? memberRows.map((m) => m.id) : [];
    if (memberIds.length === 0) return generated;

    // ── Insight 1: Overdue tickets ──────────────────────────────
    try {
      const overdueRows = await sql`
        SELECT
          COUNT(*)::int AS cnt,
          COUNT(DISTINCT assigned_to_id)::int AS affected_users
        FROM issues
        WHERE assigned_to_id = ANY(${memberIds})
          AND due_date IS NOT NULL
          AND due_date < CURRENT_DATE
          AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
      `;
      const od = (overdueRows && overdueRows[0]) || {};
      if (od.cnt > 0) {
        const insight = await upsertInsight(sql, userId, {
          insight_type: 'overdue',
          title: `${od.cnt} tickets are overdue`,
          body: `${od.cnt} ticket${od.cnt > 1 ? 's are' : ' is'} past due date across ${od.affected_users} team member${od.affected_users > 1 ? 's' : ''}. Review and reprioritise.`,
          severity: od.cnt >= 5 ? 'critical' : 'warning',
          data: { count: od.cnt, affected_users: od.affected_users },
        });
        if (insight) generated.push(insight);
      }
    } catch (err) {
      console.error('insights: overdue check error:', err.message);
    }

    // ── Insight 2: Missing timelogs ─────────────────────────────
    try {
      const noLogRows = await sql`
        SELECT u.name, u.team
        FROM users u
        WHERE u.id = ANY(${memberIds})
          AND u.active = true
          AND u.id NOT IN (
            SELECT DISTINCT user_id FROM time_entries
            WHERE spent_on >= CURRENT_DATE - INTERVAL '2 days'
          )
          AND u.id NOT IN (
            SELECT user_id FROM leave_records
            WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
          )
      `;
      if (noLogRows && noLogRows.length > 0) {
        const names = noLogRows.map((r) => r.name).slice(0, 5);
        const remaining = noLogRows.length - names.length;
        const nameStr = names.join(', ') + (remaining > 0 ? ` and ${remaining} more` : '');

        const insight = await upsertInsight(sql, userId, {
          insight_type: 'no_timelog',
          title: `${noLogRows.length} members missing timelogs`,
          body: `${nameStr} ha${noLogRows.length > 1 ? 've' : 's'} not logged time in the last 2 days and ${noLogRows.length > 1 ? 'are' : 'is'} not on leave.`,
          severity: noLogRows.length >= 3 ? 'warning' : 'info',
          data: { members: noLogRows.map((r) => ({ name: r.name, team: r.team })) },
        });
        if (insight) generated.push(insight);
      }
    } catch (err) {
      console.error('insights: no_timelog check error:', err.message);
    }

    // ── Insight 3: Capacity issues ──────────────────────────────
    try {
      const capacityRows = await sql`
        SELECT
          cs.user_id,
          cs.available_capacity_pct,
          cs.days_underloaded,
          du.display_name,
          du.team
        FROM capacity_status cs
        JOIN dashboard_users du ON du.id = cs.user_id
        WHERE du.team = ANY(${teamFilter})
          AND du.active = true
          AND (cs.available_capacity_pct > 70 AND cs.days_underloaded >= 3)
      `;
      if (capacityRows && capacityRows.length > 0) {
        const names = capacityRows.map((r) => r.display_name).slice(0, 5);
        const insight = await upsertInsight(sql, userId, {
          insight_type: 'capacity',
          title: `${capacityRows.length} developer${capacityRows.length > 1 ? 's' : ''} underloaded`,
          body: `${names.join(', ')} ha${capacityRows.length > 1 ? 've' : 's'} been under 30% workload for multiple days. Consider assigning more work.`,
          severity: 'info',
          data: {
            users: capacityRows.map((r) => ({
              name: r.display_name,
              available: Math.round(r.available_capacity_pct),
              daysUnderloaded: r.days_underloaded,
            })),
          },
        });
        if (insight) generated.push(insight);
      }
    } catch (err) {
      console.error('insights: capacity check error:', err.message);
    }

    // ── Insight 4: Deadline risk (projects) ─────────────────────
    try {
      const atRiskRows = await sql`
        SELECT
          p.id, p.name, p.deadline, p.progress_pct,
          COUNT(i.id) FILTER (WHERE i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected'))::int AS remaining,
          COUNT(i.id) FILTER (
            WHERE i.closed_at IS NOT NULL AND i.closed_at >= NOW() - INTERVAL '4 weeks'
          )::float / NULLIF(4, 0) AS velocity_per_week
        FROM projects p
        LEFT JOIN issues i ON i.project_id = p.id
        WHERE p.deadline IS NOT NULL
          AND p.deadline > CURRENT_DATE
          AND p.status = 'active'
        GROUP BY p.id, p.name, p.deadline, p.progress_pct
      `;

      if (atRiskRows && atRiskRows.length > 0) {
        for (const proj of atRiskRows) {
          const weeksUntil = Math.max(
            0,
            (new Date(proj.deadline) - new Date()) / (7 * 24 * 60 * 60 * 1000)
          );
          const velPerWeek = proj.velocity_per_week || 0;
          const weeksNeeded = velPerWeek > 0 ? proj.remaining / velPerWeek : Infinity;

          if (weeksNeeded > weeksUntil && proj.remaining > 0) {
            const byDays = Math.ceil((weeksNeeded - weeksUntil) * 7);
            const insight = await upsertInsight(sql, userId, {
              insight_type: 'deadline_risk',
              title: `${proj.name} may miss deadline`,
              body: `At current velocity, ${proj.name} needs ~${Math.ceil(weeksNeeded)} weeks but only ${Math.round(weeksUntil * 10) / 10} weeks remain. Potential miss by ${byDays} days. ${proj.remaining} tickets remaining.`,
              severity: byDays > 14 ? 'critical' : 'warning',
              data: {
                project_id: proj.id,
                project_name: proj.name,
                deadline: proj.deadline,
                remaining: proj.remaining,
                velocity: Math.round(velPerWeek * 100) / 100,
                byDays,
              },
            });
            if (insight) generated.push(insight);
          }
        }
      }
    } catch (err) {
      console.error('insights: deadline_risk check error:', err.message);
    }

    // ── Insight 5: Velocity trend ───────────────────────────────
    try {
      for (const team of teamFilter) {
        // Compare last 2 weeks vs previous 2 weeks
        const velRows = await sql`
          SELECT
            COUNT(*) FILTER (
              WHERE closed_at >= NOW() - INTERVAL '2 weeks'
            )::float AS recent_2w,
            COUNT(*) FILTER (
              WHERE closed_at >= NOW() - INTERVAL '4 weeks'
              AND closed_at < NOW() - INTERVAL '2 weeks'
            )::float AS prev_2w
          FROM issues i
          JOIN users u ON u.id = i.assigned_to_id
          WHERE u.team = ${team}
            AND i.closed_at IS NOT NULL
        `;

        const v = (velRows && velRows[0]) || {};
        const recent = v.recent_2w || 0;
        const prev = v.prev_2w || 0;

        if (prev > 0) {
          const change = ((recent - prev) / prev) * 100;
          if (change <= -20) {
            const insight = await upsertInsight(sql, userId, {
              insight_type: 'velocity',
              title: `${team} velocity dropped ${Math.round(Math.abs(change))}%`,
              body: `${team} closed ${Math.round(recent)} tickets in the last 2 weeks vs ${Math.round(prev)} in the prior 2 weeks. Investigate blockers or resource issues.`,
              severity: change <= -40 ? 'critical' : 'warning',
              data: { team, recent: Math.round(recent), previous: Math.round(prev), changePct: Math.round(change) },
            });
            if (insight) generated.push(insight);
          }
        }
      }
    } catch (err) {
      console.error('insights: velocity check error:', err.message);
    }

    // ── Insight 6: Team health ──────────────────────────────────
    try {
      const healthRows = await sql`
        SELECT DISTINCT ON (team) team, overall_score, trend
        FROM team_health
        WHERE team = ANY(${teamFilter})
        ORDER BY team, week_start DESC
      `;

      if (healthRows && healthRows.length > 0) {
        for (const h of healthRows) {
          if (h.overall_score < 50 || h.trend === 'declining') {
            const insight = await upsertInsight(sql, userId, {
              insight_type: 'health',
              title: `${h.team} health score: ${h.overall_score}/100 (${h.trend})`,
              body: `${h.team}'s health score is ${h.overall_score < 50 ? 'below average' : 'declining'}. Review on-time delivery, blocker resolution, and consistency.`,
              severity: h.overall_score < 30 ? 'critical' : 'warning',
              data: { team: h.team, score: h.overall_score, trend: h.trend },
            });
            if (insight) generated.push(insight);
          }
        }
      }
    } catch (err) {
      console.error('insights: health check error:', err.message);
    }
  } catch (err) {
    console.error('insights.generateInsightsForUser: error:', err.message);
  }

  return generated;
}

// ────────────────────────────────────────────────────────────────
// generateAllInsights — Run insight generation for all active users
// ────────────────────────────────────────────────────────────────
async function generateAllInsights() {
  const sql = getDb();
  const allResults = [];

  try {
    const users = await sql`
      SELECT id FROM dashboard_users WHERE active = true
    `;

    if (!users || users.length === 0) return allResults;

    for (const user of users) {
      const insights = await generateInsightsForUser(user.id);
      allResults.push({ userId: user.id, insights });
    }
  } catch (err) {
    console.error('insights.generateAllInsights: error:', err.message);
  }

  return allResults;
}

// ────────────────────────────────────────────────────────────────
// upsertInsight — Insert if no similar active insight exists
// ────────────────────────────────────────────────────────────────
async function upsertInsight(sql, userId, insight) {
  try {
    // Check if a similar insight already exists (same type and title, not dismissed, recent)
    const existing = await sql`
      SELECT id FROM pinned_insights
      WHERE user_id = ${userId}
        AND insight_type = ${insight.insight_type}
        AND title = ${insight.title}
        AND dismissed = false
        AND created_at >= CURRENT_DATE - INTERVAL '1 day'
      LIMIT 1
    `;

    if (existing && existing.length > 0) {
      // Update the existing insight's data and timestamp
      await sql`
        UPDATE pinned_insights
        SET
          body = ${insight.body},
          severity = ${insight.severity},
          data = ${JSON.stringify(insight.data || {})}::jsonb,
          created_at = NOW()
        WHERE id = ${existing[0].id}
      `;
      return { ...insight, id: existing[0].id, action: 'updated' };
    }

    // Insert new insight
    const insertRows = await sql`
      INSERT INTO pinned_insights (user_id, insight_type, title, body, severity, data, created_at)
      VALUES (
        ${userId},
        ${insight.insight_type},
        ${insight.title},
        ${insight.body},
        ${insight.severity},
        ${JSON.stringify(insight.data || {})}::jsonb,
        NOW()
      )
      RETURNING id
    `;

    const newId = insertRows && insertRows[0] ? insertRows[0].id : null;
    return { ...insight, id: newId, action: 'created' };
  } catch (err) {
    console.error('insights.upsertInsight: error:', err.message);
    return null;
  }
}

module.exports = {
  generateInsightsForUser,
  generateAllInsights,
};
