/**
 * intelligence/capacity.js
 * Workload tracking, capacity prediction, and availability alerts.
 */

const { getDb } = require('../lib/db');

const MAX_TICKETS_PER_DEV = 10; // 10 active tickets = 100% workload

// ────────────────────────────────────────────────────────────────
// updateCapacityStatus — Recalculate capacity for all active users
// ────────────────────────────────────────────────────────────────
async function updateCapacityStatus() {
  const sql = getDb();
  const results = [];

  try {
    // All active dashboard_users linked to Redmine
    const dashUsers = await sql`
      SELECT du.id AS dashboard_user_id, du.linked_redmine_user_id, du.team
      FROM dashboard_users du
      WHERE du.active = true
        AND du.linked_redmine_user_id IS NOT NULL
    `;

    if (!dashUsers || dashUsers.length === 0) return results;

    for (const user of dashUsers) {
      try {
        const uid = user.linked_redmine_user_id;
        const duid = user.dashboard_user_id;

        // 1. Count active tickets
        const ticketRows = await sql`
          SELECT COUNT(*)::int AS active_tickets
          FROM issues
          WHERE assigned_to_id = ${uid}
            AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
        `;
        const activeTickets = (ticketRows && ticketRows[0] && ticketRows[0].active_tickets) || 0;

        // 2. Workload percentage
        const workloadPct = Math.min((activeTickets / MAX_TICKETS_PER_DEV) * 100, 100);
        const availableCapacityPct = Math.max(100 - workloadPct, 0);

        // 3. Predict free date based on avg close rate (tickets per day over last 30 days)
        const rateRows = await sql`
          SELECT COUNT(*)::float AS closed_30d
          FROM issues
          WHERE assigned_to_id = ${uid}
            AND closed_at >= NOW() - INTERVAL '30 days'
        `;
        const closed30d = (rateRows && rateRows[0] && rateRows[0].closed_30d) || 0;
        const closeRatePerDay = closed30d / 30;

        let predictedFreeDate = null;
        let predictedFreePct = null;
        if (closeRatePerDay > 0 && activeTickets > 0) {
          const daysToFree = Math.ceil(activeTickets / closeRatePerDay);
          const freeDate = new Date();
          freeDate.setDate(freeDate.getDate() + daysToFree);
          predictedFreeDate = freeDate.toISOString().slice(0, 10);
          // Predicted capacity after current queue drains
          predictedFreePct = 100;
        }

        // 4. Calculate days_underloaded (consecutive days with < 30% workload)
        // We look at the existing record and increment if still underloaded
        const existingRows = await sql`
          SELECT days_underloaded
          FROM capacity_status
          WHERE user_id = ${duid}
        `;
        let daysUnderloaded = 0;
        if (existingRows && existingRows[0]) {
          if (availableCapacityPct > 70) {
            // < 30% workload
            daysUnderloaded = (existingRows[0].days_underloaded || 0) + 1;
          }
          // else reset to 0
        }

        // 5. Upsert into capacity_status
        await sql`
          INSERT INTO capacity_status (
            user_id, current_workload_pct, active_tickets,
            available_capacity_pct, predicted_free_date, predicted_free_pct,
            days_underloaded, alert_sent_today, last_calculated
          ) VALUES (
            ${duid}, ${workloadPct}, ${activeTickets},
            ${availableCapacityPct}, ${predictedFreeDate}, ${predictedFreePct},
            ${daysUnderloaded}, false, NOW()
          )
          ON CONFLICT (user_id)
          DO UPDATE SET
            current_workload_pct = EXCLUDED.current_workload_pct,
            active_tickets = EXCLUDED.active_tickets,
            available_capacity_pct = EXCLUDED.available_capacity_pct,
            predicted_free_date = EXCLUDED.predicted_free_date,
            predicted_free_pct = EXCLUDED.predicted_free_pct,
            days_underloaded = EXCLUDED.days_underloaded,
            alert_sent_today = false,
            last_calculated = NOW()
        `;

        // 6. Create availability_alert if underloaded for > 3 days
        if (availableCapacityPct > 50 && daysUnderloaded > 3) {
          // Check if we already sent an alert today
          const alertCheck = await sql`
            SELECT id FROM availability_alerts
            WHERE user_id = ${duid}
              AND created_at >= CURRENT_DATE
              AND actioned = false
            LIMIT 1
          `;

          if (!alertCheck || alertCheck.length === 0) {
            // Find suggested tickets: unassigned + high priority
            const suggested = await sql`
              SELECT redmine_id, title, priority
              FROM issues
              WHERE assigned_to_id IS NULL
                AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
              ORDER BY
                CASE priority
                  WHEN 'Immediate' THEN 1
                  WHEN 'Urgent' THEN 2
                  WHEN 'High' THEN 3
                  WHEN 'Normal' THEN 4
                  ELSE 5
                END
              LIMIT 3
            `;

            // Find the team lead to alert
            const leadRows = await sql`
              SELECT du.id
              FROM dashboard_users du
              WHERE du.team = ${user.team}
                AND du.role = 'team_lead'
                AND du.active = true
              LIMIT 1
            `;
            const sentTo = leadRows && leadRows[0] ? leadRows[0].id : null;

            const alertType = daysUnderloaded > 5 ? 'underloaded' : 'becoming_free';

            await sql`
              INSERT INTO availability_alerts (
                user_id, available_capacity, alert_type,
                suggested_tickets, sent_to, created_at
              ) VALUES (
                ${duid},
                ${availableCapacityPct},
                ${alertType},
                ${JSON.stringify(suggested || [])}::jsonb,
                ${sentTo},
                NOW()
              )
            `;

            // Mark alert sent
            await sql`
              UPDATE capacity_status
              SET alert_sent_today = true
              WHERE user_id = ${duid}
            `;
          }
        }

        results.push({
          userId: duid,
          activeTickets,
          workloadPct: Math.round(workloadPct),
          availableCapacityPct: Math.round(availableCapacityPct),
          daysUnderloaded,
        });
      } catch (userErr) {
        console.error(`capacity: error for user ${user.dashboard_user_id}:`, userErr.message);
      }
    }
  } catch (err) {
    console.error('capacity.updateCapacityStatus: error:', err.message);
  }

  return results;
}

// ────────────────────────────────────────────────────────────────
// getCapacityForTeam — Current capacity rows for a team
// ────────────────────────────────────────────────────────────────
async function getCapacityForTeam(team) {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT
        cs.*,
        du.display_name,
        du.team
      FROM capacity_status cs
      JOIN dashboard_users du ON du.id = cs.user_id
      WHERE du.team = ${team}
        AND du.active = true
      ORDER BY cs.current_workload_pct DESC
    `;
    return rows || [];
  } catch (err) {
    console.error('capacity.getCapacityForTeam: error:', err.message);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// getAvailableDevelopers — Users with capacity > 30%
// ────────────────────────────────────────────────────────────────
async function getAvailableDevelopers(team) {
  const sql = getDb();
  try {
    let rows;
    if (team) {
      rows = await sql`
        SELECT
          cs.*,
          du.display_name,
          du.team,
          du.linked_redmine_user_id
        FROM capacity_status cs
        JOIN dashboard_users du ON du.id = cs.user_id
        WHERE du.team = ${team}
          AND du.active = true
          AND cs.available_capacity_pct > 30
        ORDER BY cs.available_capacity_pct DESC
      `;
    } else {
      rows = await sql`
        SELECT
          cs.*,
          du.display_name,
          du.team,
          du.linked_redmine_user_id
        FROM capacity_status cs
        JOIN dashboard_users du ON du.id = cs.user_id
        WHERE du.active = true
          AND cs.available_capacity_pct > 30
        ORDER BY cs.available_capacity_pct DESC
      `;
    }
    return rows || [];
  } catch (err) {
    console.error('capacity.getAvailableDevelopers: error:', err.message);
    return [];
  }
}

module.exports = {
  updateCapacityStatus,
  getCapacityForTeam,
  getAvailableDevelopers,
};
