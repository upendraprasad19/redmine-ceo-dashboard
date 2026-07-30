const { getCurrentUser } = require('../../lib/auth')
const { getDb } = require('../../lib/db')
const { chat } = require('../../lib/ai')
const { send500 } = require('../../lib/api-error')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const { personId } = req.body
    if (!personId) return res.status(400).json({ error: 'personId is required' })

    const sql = getDb()

    // Fetch person's data
    const personRows = await sql`
      SELECT id, name, team, role, initials
      FROM users WHERE id = ${personId} AND active = true LIMIT 1
    `
    if (personRows.length === 0) {
      return res.status(404).json({ error: 'Person not found' })
    }
    const person = personRows[0]

    // Fetch recent tickets, hours, blockers, overdue items
    const [tickets, hours, overdue, recentActivity] = await Promise.all([
      sql`
        SELECT i.id, i.title, i.status, i.priority, i.due_date
        FROM issues i
        WHERE i.assigned_to_id = ${personId}
          AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
        ORDER BY i.due_date ASC NULLS LAST
        LIMIT 10
      `,
      sql`
        SELECT
          COALESCE(SUM(CASE WHEN te.spent_on >= date_trunc('week', CURRENT_DATE) THEN te.hours ELSE 0 END), 0) AS hours_this_week,
          COALESCE(SUM(CASE WHEN te.spent_on >= date_trunc('month', CURRENT_DATE) THEN te.hours ELSE 0 END), 0) AS hours_this_month
        FROM time_entries te
        WHERE te.user_id = ${personId}
      `,
      sql`
        SELECT COUNT(*) AS count
        FROM issues
        WHERE assigned_to_id = ${personId}
          AND due_date IS NOT NULL
          AND due_date < CURRENT_DATE
          AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
      `,
      sql`
        SELECT i.title, i.status, ij.notes, ij.created_at
        FROM issue_journals ij
        JOIN issues i ON i.id = ij.issue_id
        WHERE ij.author_id = ${personId} AND ij.notes IS NOT NULL
        ORDER BY ij.created_at DESC
        LIMIT 5
      `,
    ])

    const blockedTickets = tickets.filter((t) => t.status === 'Blocked')
    const hoursData = hours[0] || { hours_this_week: 0, hours_this_month: 0 }
    const overdueCount = parseInt(overdue[0]?.count || 0, 10)

    // Build data summary
    const dataSummary = `
Team: ${person.team}
Role: ${person.role}
Open tickets: ${tickets.length}
Blocked tickets: ${blockedTickets.length} ${blockedTickets.length > 0 ? `(${blockedTickets.map((t) => t.title).join(', ')})` : ''}
Overdue items: ${overdueCount}
Hours this week: ${hoursData.hours_this_week}h
Hours this month: ${hoursData.hours_this_month}h
Recent ticket titles: ${tickets
      .slice(0, 5)
      .map((t) => `${t.title} [${t.status}]`)
      .join('; ')}
Recent activity: ${recentActivity.map((a) => a.notes?.substring(0, 80)).join('; ') || 'No recent journal entries'}
`.trim()

    // Call AI for talking points
    const aiMessages = [
      {
        role: 'system',
        content:
          'You are a helpful management assistant. Generate concise, actionable 1-on-1 meeting talking points. Use bullet points. Be specific based on the data provided.',
      },
      {
        role: 'user',
        content: `Generate 1-on-1 talking points for a meeting with ${person.name}.
Their current data:
${dataSummary}

Include sections for:
- Quick wins / recognition
- Blockers to discuss
- Workload check-in
- Growth / development
- Action items

Keep it concise with bullet points. Focus on the most important items.`,
      },
    ]

    const response = await chat(aiMessages)
    const talkingPoints =
      response.choices[0]?.message?.content || 'Unable to generate talking points at this time.'

    res.status(200).json({
      person: { id: person.id, name: person.name, team: person.team, role: person.role },
      talking_points: talkingPoints,
      data_summary: {
        open_tickets: tickets.length,
        blocked: blockedTickets.length,
        overdue: overdueCount,
        hours_this_week: hoursData.hours_this_week,
        hours_this_month: hoursData.hours_this_month,
      },
    })
  } catch (err) {
    return send500(res, err, 'one-on-one')
  }
}
