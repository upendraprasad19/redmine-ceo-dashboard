/**
 * intelligence/matcher.js
 * Ticket-to-developer matching: find the best available developer for a ticket.
 */

const { getDb } = require('../lib/db');

// ────────────────────────────────────────────────────────────────
// matchTicketToDeveloper — Score and rank developers for a ticket
// ────────────────────────────────────────────────────────────────
async function matchTicketToDeveloper(ticketId) {
  const sql = getDb();

  try {
    // 1. Get ticket details
    const ticketRows = await sql`
      SELECT
        i.id, i.redmine_id, i.title, i.priority, i.project_id,
        i.description, i.status,
        p.name AS project_name
      FROM issues i
      LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.id = ${ticketId} OR i.redmine_id = ${ticketId}
      LIMIT 1
    `;

    if (!ticketRows || ticketRows.length === 0) {
      return { error: 'Ticket not found', suggestions: [] };
    }

    const ticket = ticketRows[0];

    // 2. Get available developers (from capacity_status)
    const developers = await sql`
      SELECT
        cs.user_id AS dashboard_user_id,
        cs.available_capacity_pct,
        cs.active_tickets,
        cs.current_workload_pct,
        du.display_name,
        du.team,
        du.linked_redmine_user_id
      FROM capacity_status cs
      JOIN dashboard_users du ON du.id = cs.user_id
      WHERE du.active = true
        AND cs.available_capacity_pct > 10
      ORDER BY cs.available_capacity_pct DESC
    `;

    if (!developers || developers.length === 0) {
      return {
        ticket: { id: ticket.id, title: ticket.title },
        suggestions: [],
        reason: 'No developers with available capacity',
      };
    }

    // 3. Score each developer
    const scored = [];

    for (const dev of developers) {
      try {
        const uid = dev.linked_redmine_user_id;
        if (!uid) continue;

        let score = 0;
        const factors = {};

        // a) Capacity score (0-40): higher capacity = higher score
        const capacityScore = Math.min(40, Math.round((dev.available_capacity_pct / 100) * 40));
        score += capacityScore;
        factors.capacity = capacityScore;

        // b) Project familiarity (0-30): how many tickets in same project has this dev worked on?
        const familiarityRows = await sql`
          SELECT COUNT(*)::int AS project_tickets
          FROM issues
          WHERE assigned_to_id = ${uid}
            AND project_id = ${ticket.project_id}
        `;
        const projectTickets = (familiarityRows && familiarityRows[0] && familiarityRows[0].project_tickets) || 0;
        const familiarityScore = Math.min(30, projectTickets * 3);
        score += familiarityScore;
        factors.familiarity = familiarityScore;

        // c) Recent performance (0-30): based on latest performance snapshot
        const perfRows = await sql`
          SELECT overall_score
          FROM performance_snapshots
          WHERE user_id = ${dev.dashboard_user_id}
          ORDER BY snapshot_date DESC
          LIMIT 1
        `;
        const perfScore = perfRows && perfRows[0] ? Math.round((perfRows[0].overall_score / 100) * 30) : 15;
        score += perfScore;
        factors.performance = perfScore;

        scored.push({
          dashboardUserId: dev.dashboard_user_id,
          redmineUserId: uid,
          displayName: dev.display_name,
          team: dev.team,
          availableCapacity: Math.round(dev.available_capacity_pct),
          activeTickets: dev.active_tickets,
          score,
          factors,
        });
      } catch (devErr) {
        console.error(`matcher: error scoring dev ${dev.display_name}:`, devErr.message);
      }
    }

    // 4. Sort by score descending and return top 3
    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3);

    return {
      ticket: {
        id: ticket.id,
        redmineId: ticket.redmine_id,
        title: ticket.title,
        priority: ticket.priority,
        projectName: ticket.project_name,
      },
      suggestions: top3,
      totalCandidates: scored.length,
    };
  } catch (err) {
    console.error('matcher.matchTicketToDeveloper: error:', err.message);
    return { error: err.message, suggestions: [] };
  }
}

module.exports = {
  matchTicketToDeveloper,
};
