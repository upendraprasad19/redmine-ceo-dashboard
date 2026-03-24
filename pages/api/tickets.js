import { getDb } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();

    const tickets = await sql`
      SELECT
        i.id,
        'TK-' || i.redmine_id AS ticket_id,
        i.title,
        i.bz_id,
        i.status,
        i.priority,
        i.start_date,
        i.due_date,
        i.created_at,
        (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed', 'Resolved')) AS overdue,
        p.name  AS project_name,
        u1.name AS assigned_to,
        u1.team AS team,
        u1.role AS role,
        u2.name AS assigned_by,
        pm.name AS manager,
        th.db_assignee,
        th.java_assignee,
        th.js_assignee,
        th.qa_assignee,
        th.ai_assignee,
        th.devops_assignee,
        j.notes AS last_comment,
        uj.name AS comment_by,
        j.created_at AS last_update
      FROM issues i
      LEFT JOIN projects p    ON p.id = i.project_id
      LEFT JOIN users pm      ON pm.id = p.manager_id
      LEFT JOIN users u1      ON u1.id = i.assigned_to_id
      LEFT JOIN users u2      ON u2.id = i.author_id
      -- Historical team tracking pivot
      LEFT JOIN LATERAL (
        SELECT 
          MAX(CASE WHEN h.team_name = 'DB' THEN uh.name END) AS db_assignee,
          MAX(CASE WHEN h.team_name = 'Java' THEN uh.name END) AS java_assignee,
          MAX(CASE WHEN h.team_name = 'JS/UI' THEN uh.name END) AS js_assignee,
          MAX(CASE WHEN h.team_name = 'QA' THEN uh.name END) AS qa_assignee,
          MAX(CASE WHEN h.team_name = 'AI' THEN uh.name END) AS ai_assignee,
          MAX(CASE WHEN h.team_name = 'DevOps' THEN uh.name END) AS devops_assignee
        FROM issue_team_history h
        JOIN users uh ON uh.id = h.user_id
        WHERE h.issue_id = i.id
      ) th ON true
      -- Latest journal entry per issue
      LEFT JOIN LATERAL (
        SELECT ij.notes, ij.author_id, ij.created_at
        FROM issue_journals ij
        WHERE ij.issue_id = i.id AND ij.notes IS NOT NULL
        ORDER BY ij.created_at DESC
        LIMIT 1
      ) j ON true
      LEFT JOIN users uj ON uj.id = j.author_id
      WHERE i.status NOT IN ('Closed', 'Resolved')
      ORDER BY (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed', 'Resolved')) DESC, i.due_date ASC NULLS LAST
    `;

    res.status(200).json({ tickets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
