const { getDb } = require('../../../lib/db')
const { getCurrentUser } = require('../../../lib/auth')
const { send500 } = require('../../../lib/api-error')

const VALID_BRIEFING_DAYS = ['weekdays', 'everyday', 'never']
const VALID_MORNING_BRIEFING = ['none', 'short', 'detailed']
const VALID_CHANNELS = ['telegram', 'email']

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const { briefing_time, briefing_days, morning_briefing, notification_channels } = req.body || {}
    const sql = getDb()

    // Validate each field only if present in body
    if (briefing_days !== undefined && !VALID_BRIEFING_DAYS.includes(briefing_days)) {
      return res
        .status(400)
        .json({ error: `briefing_days must be one of: ${VALID_BRIEFING_DAYS.join(', ')}` })
    }
    if (morning_briefing !== undefined && !VALID_MORNING_BRIEFING.includes(morning_briefing)) {
      return res
        .status(400)
        .json({ error: `morning_briefing must be one of: ${VALID_MORNING_BRIEFING.join(', ')}` })
    }
    if (notification_channels !== undefined) {
      if (
        !Array.isArray(notification_channels) ||
        !notification_channels.every((c) => VALID_CHANNELS.includes(c))
      ) {
        return res.status(400).json({
          error: `notification_channels must be an array of: ${VALID_CHANNELS.join(', ')}`,
        })
      }
    }
    if (briefing_time !== undefined && !/^\d{2}:\d{2}(:\d{2})?$/.test(briefing_time)) {
      return res.status(400).json({ error: 'briefing_time must be HH:MM or HH:MM:SS' })
    }

    // COALESCE — only touch columns the caller sent
    await sql`
      UPDATE dashboard_users SET
        briefing_time        = COALESCE(${briefing_time ?? null}, briefing_time),
        briefing_days        = COALESCE(${briefing_days ?? null}, briefing_days),
        morning_briefing     = COALESCE(${morning_briefing ?? null}, morning_briefing),
        notification_channels = COALESCE(${notification_channels ?? null}, notification_channels),
        updated_at           = NOW()
      WHERE id = ${user.id}
    `

    const rows = await sql`
      SELECT briefing_time, briefing_days, morning_briefing, notification_channels
      FROM dashboard_users WHERE id = ${user.id} LIMIT 1
    `
    return res.status(200).json(rows[0])
  } catch (err) {
    return send500(res, err, 'profile-prefs')
  }
}
