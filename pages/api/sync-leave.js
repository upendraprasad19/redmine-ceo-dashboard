import { send500 } from '../../lib/api-error'
import { getCurrentUser } from '../../lib/auth'
import { getDb } from '../../lib/db'

const BLOCKED_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^127\./,
  /^0\./,
  /^localhost$/i,
]

function isPrivateHost(hostname) {
  return BLOCKED_IP_RANGES.some((re) => re.test(hostname))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  if (user.role !== 'manager') return res.status(403).json({ error: 'Insufficient permissions' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'Google Sheet CSV URL is required' })

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  if (parsed.hostname !== 'docs.google.com' || !parsed.pathname.includes('/spreadsheets')) {
    return res.status(400).json({
      error:
        'URL must be a valid Google Sheets CSV export link. Go to File > Share > Publish to web, and choose CSV.',
    })
  }

  if (!parsed.searchParams.has('format') || parsed.searchParams.get('format') !== 'csv') {
    return res
      .status(400)
      .json({ error: 'URL must be a CSV export link (format=csv parameter required)' })
  }

  if (isPrivateHost(parsed.hostname)) {
    return res.status(400).json({ error: 'URL host not allowed' })
  }

  const sql = getDb()

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to download Google Sheet data')
    const csvText = await response.text()

    const lines = csvText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length < 2) return res.status(400).json({ error: 'CSV is empty or missing headers' })

    // Assuming the sheet has a flexible format. We will try to match User Names.
    // For a robust sync, we clear today's google_sheet leaves and rewrite them.
    await sql`DELETE FROM leave_records WHERE source = 'google_sheet' AND end_date >= CURRENT_DATE`

    const users = await sql`SELECT id, name FROM users WHERE active = true`
    const userMap = new Map()
    users.forEach((u) => userMap.set(u.name.toLowerCase().replace(/\s+/g, ''), u.id))

    let addedCount = 0
    // VERY simple parser: looking for name matches in columns
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim())

      let matchedUserId = null
      const notes = lines[i]

      // Try to find a user name anywhere in the row
      for (const col of cols) {
        const normalized = col.toLowerCase().replace(/\s+/g, '')
        if (userMap.has(normalized)) {
          matchedUserId = userMap.get(normalized)
          break
        }
      }

      if (matchedUserId) {
        await sql`
          INSERT INTO leave_records (user_id, leave_type, start_date, end_date, notes, source)
          VALUES (${matchedUserId}, 'Synced from Sheet', CURRENT_DATE, CURRENT_DATE, ${notes.substring(0, 200)}, 'google_sheet')
        `
        addedCount++
      }
    }

    res.status(200).json({ success: true, records_added: addedCount })
  } catch (err) {
    return send500(res, err, 'sync-leave')
  }
}
