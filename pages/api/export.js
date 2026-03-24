// pages/api/export.js
// GET /api/export?type=csv&scope=tickets|timelogs|people|overview
// Returns CSV file download

import { getDb } from '../../lib/db';

function checkSession(req) {
  const raw = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    raw.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
  const session = cookies['ceo_session'];
  return session && session === process.env.SESSION_SECRET;
}

function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const str = String(v);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Session auth check
  if (!checkSession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { scope = 'tickets' } = req.query;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const sql = getDb();
    let rows = [];
    let filename = `export-${scope}-${today}.csv`;

    if (scope === 'tickets') {
      const data = await sql`
        SELECT
          i.id                                           AS "ID",
          i.title                                        AS "Title",
          i.status                                       AS "Status",
          i.priority                                     AS "Priority",
          p.name                                         AS "Project",
          u1.name                                        AS "Assigned To",
          i.due_date                                     AS "Due Date",
          CASE
            WHEN i.due_date IS NOT NULL
              AND i.due_date < CURRENT_DATE
              AND i.status NOT IN ('Closed','Resolved')
            THEN 'Yes'
            ELSE 'No'
          END                                            AS "Overdue"
        FROM issues i
        LEFT JOIN projects p  ON p.id = i.project_id
        LEFT JOIN users u1    ON u1.id = i.assigned_to_id
        WHERE i.status NOT IN ('Closed','Resolved')
        ORDER BY i.due_date ASC NULLS LAST
      `;
      rows = data;

    } else if (scope === 'timelogs') {
      const data = await sql`
        SELECT
          te.spent_on                 AS "Date",
          u.name                      AS "User",
          u.team                      AS "Team",
          p.name                      AS "Project",
          te.hours                    AS "Hours"
        FROM time_entries te
        LEFT JOIN users u    ON u.id = te.user_id
        LEFT JOIN projects p ON p.id = te.project_id
        WHERE te.spent_on >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY te.spent_on DESC, u.name
      `;
      rows = data;

    } else if (scope === 'people') {
      const data = await sql`
        SELECT
          u.name                                                              AS "Name",
          u.team                                                              AS "Team",
          u.role                                                              AS "Role",
          (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id
           AND i.status NOT IN ('Closed','Resolved'))                        AS "Open Tickets",
          COALESCE((SELECT SUM(te.hours) FROM time_entries te
                    WHERE te.user_id = u.id
                    AND te.spent_on >= date_trunc('month', CURRENT_DATE)), 0) AS "Hours This Month"
        FROM users u
        WHERE u.active = true
        ORDER BY u.team, u.name
      `;
      rows = data;

    } else if (scope === 'overview') {
      // Return a summary overview CSV
      const data = await sql`
        SELECT
          u.team                                                                AS "Team",
          COUNT(DISTINCT u.id)                                                  AS "Members",
          COUNT(DISTINCT i.id) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS "Open Tickets",
          ROUND(
            COUNT(DISTINCT i.id) FILTER (WHERE i.status NOT IN ('Closed','Resolved'))::numeric
            / NULLIF(COUNT(DISTINCT u.id), 0), 2
          )                                                                     AS "Avg Tickets/Person",
          COALESCE(SUM(te.hours) FILTER (WHERE te.spent_on = CURRENT_DATE), 0)  AS "Hours Today"
        FROM users u
        LEFT JOIN issues i   ON i.assigned_to_id = u.id
        LEFT JOIN time_entries te ON te.user_id = u.id
        WHERE u.active = true
        GROUP BY u.team
        ORDER BY u.team
      `;
      rows = data;

    } else {
      return res.status(400).json({ error: `Unknown scope: ${scope}. Use tickets, timelogs, people, or overview.` });
    }

    const csv = toCSV(rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);

  } catch (err) {
    console.error('[export]', err);
    res.status(500).json({ error: err.message });
  }
}
