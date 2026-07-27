const { getCurrentUser } = require('../../lib/auth')
const { getDb } = require('../../lib/db')
const { send500 } = require('../../lib/api-error')

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const sql = getDb()
    const isTeamLead = user.role === 'team_lead'
    const team = user.team

    const health = isTeamLead
      ? await sql`
          SELECT team, week_start, overall_score, trend
          FROM team_health
          WHERE team = ${team}
          ORDER BY week_start DESC
          LIMIT 1
        `
      : await sql`
          SELECT DISTINCT ON (team) team, week_start, overall_score, trend
          FROM team_health
          ORDER BY team, week_start DESC
        `

    res.status(200).json({ health })
  } catch (err) {
    console.error('Team health error:', err)
    send500(res, err, 'team-health')
  }
}
