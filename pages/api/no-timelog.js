const { getCurrentUser } = require('../../lib/auth')
const { getDb } = require('../../lib/db')
const { send500 } = require('../../lib/api-error')

const EXPECTED_TIME_TEAMS = ['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const sql = getDb()
    const isTeamLead = user.role === 'team_lead'
    const team = user.team

    // Get all active team-assigned users with today's AND yesterday's hours
    const rows = isTeamLead
      ? await sql`
          SELECT u.id, u.name, u.team,
            COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE), 0) AS today_hours,
            COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE - 1), 0) AS yesterday_hours
          FROM users u
          WHERE u.active = true
            AND u.team = ${team}
            AND u.team = ANY(${EXPECTED_TIME_TEAMS}::text[])
          ORDER BY u.team, u.name
        `
      : await sql`
          SELECT u.id, u.name, u.team,
            COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE), 0) AS today_hours,
            COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE - 1), 0) AS yesterday_hours
          FROM users u
          WHERE u.active = true
            AND u.team = ANY(${EXPECTED_TIME_TEAMS}::text[])
          ORDER BY u.team, u.name
        `

    // --- TODAY ---
    const todayLogged = rows.filter((r) => parseFloat(r.today_hours) > 0)
    const todayNotLogged = rows.filter((r) => parseFloat(r.today_hours) === 0)

    // Group today's logged by team (with per-person hours)
    const todayByTeam = {}
    for (const r of todayLogged) {
      if (!todayByTeam[r.team]) todayByTeam[r.team] = []
      todayByTeam[r.team].push({ id: r.id, name: r.name, hours: parseFloat(r.today_hours) })
    }

    // Group today's NOT logged by team
    const todayNoLogByTeam = {}
    for (const r of todayNotLogged) {
      if (!todayNoLogByTeam[r.team]) todayNoLogByTeam[r.team] = []
      todayNoLogByTeam[r.team].push({ id: r.id, name: r.name })
    }

    // --- YESTERDAY ---
    const yesterdayNotLogged = rows.filter((r) => parseFloat(r.yesterday_hours) === 0)
    const yesterdayLogged = rows.filter((r) => parseFloat(r.yesterday_hours) > 0)

    // Group yesterday's NOT logged by team
    const yesterdayNoLogByTeam = {}
    for (const r of yesterdayNotLogged) {
      if (!yesterdayNoLogByTeam[r.team]) yesterdayNoLogByTeam[r.team] = []
      yesterdayNoLogByTeam[r.team].push({ id: r.id, name: r.name })
    }

    // Group yesterday's logged by team (with per-person hours)
    const yesterdayByTeam = {}
    for (const r of yesterdayLogged) {
      if (!yesterdayByTeam[r.team]) yesterdayByTeam[r.team] = []
      yesterdayByTeam[r.team].push({ id: r.id, name: r.name, hours: parseFloat(r.yesterday_hours) })
    }

    // Team-wise summary for both days
    const teamSummary = {}
    for (const r of rows) {
      if (!teamSummary[r.team])
        teamSummary[r.team] = { today_total: 0, yesterday_total: 0, members: 0 }
      teamSummary[r.team].today_total += parseFloat(r.today_hours)
      teamSummary[r.team].yesterday_total += parseFloat(r.yesterday_hours)
      teamSummary[r.team].members++
    }

    res.status(200).json({
      today: {
        logged_by_team: todayByTeam,
        no_log_by_team: todayNoLogByTeam,
        total_logged: todayLogged.length,
        total_not_logged: todayNotLogged.length,
      },
      yesterday: {
        logged_by_team: yesterdayByTeam,
        no_log_by_team: yesterdayNoLogByTeam,
        total_logged: yesterdayLogged.length,
        total_not_logged: yesterdayNotLogged.length,
      },
      team_summary: teamSummary,
      total_users: rows.length,
    })
  } catch (err) {
    console.error('No-timelog API error:', err)
    send500(res, err, 'no-timelog')
  }
}
