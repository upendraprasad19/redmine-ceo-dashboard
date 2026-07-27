/**
 * POST /api/sync — Runs Redmine sync inline (works on Vercel serverless)
 * Called by Vercel Cron daily + dashboard "Refresh Data" button
 */
const { getDb } = require('../../lib/db')

const REDMINE_URL = (process.env.REDMINE_URL || '').replace(/\/$/, '')
const REDMINE_KEY = process.env.REDMINE_API_KEY

async function redmineFetch(path) {
  if (!REDMINE_URL || !REDMINE_KEY) throw new Error('Redmine not configured')
  const url = `${REDMINE_URL}${path}${path.includes('?') ? '&' : '?'}key=${REDMINE_KEY}`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`Redmine ${res.status}: ${res.statusText}`)
  return res.json()
}

async function fetchAll(endpoint, key, params = '') {
  let results = []
  let offset = 0
  const limit = 100
  let totalCount = 1
  while (offset < totalCount) {
    const data = await redmineFetch(`${endpoint}.json?limit=${limit}&offset=${offset}${params}`)
    results = results.concat(data[key] || [])
    totalCount = data.total_count || 0
    offset += limit
  }
  return results
}

const userCache = new Map()
const projectCache = new Map()
const deliveryOwnerEnumToNeonId = new Map()

const APPROVED_PROJECT_IDS = new Set([
  2, 3, 5, 7, 14, 15, 16, 17, 18, 19, 20, 21, 23, 29, 34, 43, 44, 47, 49, 50, 51, 55, 56, 57, 60,
  61, 62, 63, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
])
const FALLBACK_DAYS = 182

async function buildDeliveryOwnerEnumMap(sql) {
  deliveryOwnerEnumToNeonId.clear()
  try {
    const data = await redmineFetch('/custom_fields.json')
    const cf = (data.custom_fields || []).find((c) => c.id === 25)
    const pv = cf?.possible_values || []
    for (const opt of pv) {
      const rows = await sql`SELECT id FROM users WHERE name = ${opt.label} LIMIT 1`
      if (rows.length > 0) deliveryOwnerEnumToNeonId.set(String(opt.value), rows[0].id)
    }
    return `Delivery Owner enum map: ${deliveryOwnerEnumToNeonId.size}/${pv.length} resolved`
  } catch (e) {
    return `Delivery Owner enum map failed: ${e.message}`
  }
}

async function getNeonUserId(sql, u) {
  if (!u) return null
  if (userCache.has(u.id)) return userCache.get(u.id)
  const existing = await sql`SELECT id FROM users WHERE redmine_id = ${u.id} LIMIT 1`
  if (existing.length > 0) {
    userCache.set(u.id, existing[0].id)
    return existing[0].id
  }
  const initials = u.name
    ? u.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'XX'
  const res = await sql`
    INSERT INTO users (redmine_id, name, initials, active)
    VALUES (${u.id}, ${u.name || 'Unknown'}, ${initials}, true)
    ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `
  userCache.set(u.id, res[0].id)
  return res[0].id
}

export default async function handler(req, res) {
  // Accept both POST (dashboard button) and GET (Vercel Cron)
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end()

  // Require CRON_SECRET for all calls (Vercel Cron, dashboard button, or manual)
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(501).json({ error: 'CRON_SECRET not configured' })
  }
  const authHeader = req.headers.authorization || ''
  const bearerToken = authHeader.replace('Bearer ', '')
  const headerSecret = req.headers['x-cron-secret']
  if (bearerToken !== cronSecret && headerSecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const sql = getDb()
    const log = []

    // Determine sync window from sync_state (consistent with scripts/sync-redmine.js)
    let sinceDate
    const lastRow = await sql`SELECT value FROM sync_state WHERE key = 'last_synced_at'`
    if (lastRow.length > 0 && lastRow[0].value) {
      const last = new Date(lastRow[0].value)
      last.setDate(last.getDate() - 1) // 1-day buffer
      sinceDate = last.toISOString().split('T')[0]
      log.push(`Delta sync — last synced ${lastRow[0].value.substring(0, 10)}, using ${sinceDate}`)
    } else {
      const cutoff = new Date(Date.now() - FALLBACK_DAYS * 24 * 60 * 60 * 1000)
      sinceDate = cutoff.toISOString().split('T')[0]
      log.push(`No prior sync state — fallback ${FALLBACK_DAYS}d window from ${sinceDate}`)
    }

    // 1. Sync users
    log.push('Syncing users...')
    try {
      const users = await fetchAll('/users', 'users', '&status=0')
      for (const u of users) {
        const initials =
          u.firstname && u.lastname ? `${u.firstname[0]}${u.lastname[0]}`.toUpperCase() : 'XX'
        const name = `${u.firstname || ''} ${u.lastname || ''}`.trim()
        const r = await sql`
          INSERT INTO users (redmine_id, name, email, initials, active)
          VALUES (${u.id}, ${name}, ${u.mail || null}, ${initials}, true)
          ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()
          RETURNING id
        `
        userCache.set(u.id, r[0].id)
      }
      log.push(`  Users: ${users.length} synced`)
    } catch (e) {
      log.push(`  Users: restricted (${e.message})`)
    }

    // 2. Sync projects
    log.push('Syncing projects...')
    const projects = await fetchAll('/projects', 'projects')
    for (const p of projects) {
      const r = await sql`
        INSERT INTO projects (redmine_id, name, description, status)
        VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
        ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
        RETURNING id
      `
      projectCache.set(p.id, r[0].id)
    }
    log.push(`  Projects: ${projects.length} synced`)

    // 3. Build Delivery Owner enum map (after projects, before issues)
    log.push('Building Delivery Owner enum map...')
    const doResult = await buildDeliveryOwnerEnumMap(sql)
    log.push(`  ${doResult}`)

    // 4. Sync issues (delta window, approved projects only)
    log.push(`Syncing issues since ${sinceDate}...`)
    const issues = await fetchAll(
      '/issues',
      'issues',
      `&status_id=*&updated_on=>=${sinceDate}&sort=updated_on:desc`,
    )
    const filteredIssues = issues.filter((i) => APPROVED_PROJECT_IDS.has(i.project?.id))
    const statusMap = {
      New: 'New',
      'In Progress': 'In Progress',
      'Re Open': 'Re Open',
      Open: 'Open',
      'Code Review': 'Review',
      Feedback: 'Closed',
      Blocked: 'Blocked',
      Resolved: 'Closed',
      Closed: 'Closed',
      Verified: 'Closed',
      Rejected: 'Closed',
    }
    const priorityMap = {
      Low: 'Low',
      Normal: 'Medium',
      High: 'High',
      Urgent: 'Critical',
      Immediate: 'Critical',
    }

    for (const issue of filteredIssues) {
      const assigneeId = await getNeonUserId(sql, issue.assigned_to)
      const authorId = await getNeonUserId(sql, issue.author)
      const projectId = projectCache.get(issue.project?.id)
      const status = statusMap[issue.status?.name] || issue.status?.name || 'New'
      const priority = priorityMap[issue.priority?.name] || 'Medium'
      const bzField = issue.custom_fields?.find((cf) => cf.id === 9)
      const bzId = bzField ? String(bzField.value) : null

      // Delivery Owner (custom field 25) — enumeration field, not User field
      const doField = issue.custom_fields?.find((cf) => cf.id === 25)
      const doEnumVals = Array.isArray(doField?.value)
        ? doField.value
        : doField?.value
          ? [doField.value]
          : []
      const resolvedIds = doEnumVals
        .map((v) => deliveryOwnerEnumToNeonId.get(String(v)))
        .filter(Boolean)
      const deliveryOwnerIds = resolvedIds.length > 0 ? resolvedIds : null

      await sql`
        INSERT INTO issues (redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, bz_id, delivery_owner_ids, start_date, due_date, done_ratio, closed_at, created_at, updated_at)
        VALUES (${issue.id}, ${projectId || null}, ${issue.subject}, ${issue.description || null}, ${status}, ${priority}, ${assigneeId}, ${authorId}, ${bzId}, ${deliveryOwnerIds}, ${issue.start_date || null}, ${issue.due_date || null}, ${issue.done_ratio || 0}, ${issue.closed_on || null}, ${issue.created_on}, ${issue.updated_on})
        ON CONFLICT (redmine_id) DO UPDATE SET status=EXCLUDED.status, priority=EXCLUDED.priority, assigned_to_id=EXCLUDED.assigned_to_id, bz_id=EXCLUDED.bz_id, delivery_owner_ids=EXCLUDED.delivery_owner_ids, done_ratio=EXCLUDED.done_ratio, due_date=EXCLUDED.due_date, closed_at=EXCLUDED.closed_at, updated_at=EXCLUDED.updated_at
      `

      // Sync issue_team_history
      if (assigneeId) {
        await sql`
          WITH issue_data AS (
            SELECT i.id AS neon_issue_id, u.team AS team_name, u.id AS neon_user_id
            FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            WHERE i.redmine_id = ${issue.id} AND u.team IS NOT NULL
          )
          INSERT INTO issue_team_history (issue_id, team_name, user_id, assigned_at)
          SELECT neon_issue_id, team_name, neon_user_id, NOW()
          FROM issue_data
          ON CONFLICT (issue_id, team_name) DO UPDATE SET user_id=EXCLUDED.user_id, assigned_at=EXCLUDED.assigned_at
        `
      }
    }
    log.push(
      `  Issues: ${filteredIssues.length} synced (${issues.length} total fetched, ${issues.length - filteredIssues.length} filtered out)`,
    )

    // 5. Sync time entries (delta window, approved projects only)
    log.push(`Syncing time entries since ${sinceDate}...`)
    const entries = await fetchAll('/time_entries', 'time_entries', `&spent_on=>=${sinceDate}`)
    const filteredEntries = entries.filter((e) => APPROVED_PROJECT_IDS.has(e.project?.id))
    for (const e of filteredEntries) {
      const userId = await getNeonUserId(sql, e.user)
      const projectId = projectCache.get(e.project?.id)
      const resIssue = e.issue
        ? await sql`SELECT id FROM issues WHERE redmine_id = ${e.issue.id} LIMIT 1`
        : []

      await sql`
        INSERT INTO time_entries (redmine_id, issue_id, user_id, project_id, hours, activity, comments, spent_on, created_at)
        VALUES (${e.id}, ${resIssue[0]?.id || null}, ${userId}, ${projectId || null}, ${e.hours}, ${e.activity?.name || null}, ${e.comments || null}, ${e.spent_on}, ${e.created_on})
        ON CONFLICT (redmine_id) DO UPDATE SET hours=EXCLUDED.hours, comments=EXCLUDED.comments
      `
    }
    log.push(
      `  Time entries: ${filteredEntries.length} synced (${entries.length - filteredEntries.length} filtered out)`,
    )

    // 6. Update sync state
    await sql`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('last_synced_at', ${new Date().toISOString()}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `
    log.push('Sync state updated')

    // 7. Weekly reconciliation (piggyback — runs at most once per 7 days)
    const reconcileRow = await sql`SELECT value FROM sync_state WHERE key = 'last_reconcile_at'`
    if (reconcileRow.length === 0) {
      log.push('Reconcile skipped: no baseline yet (first sync only covers recent window)')
    } else {
      const { runWeeklyReconcile } = require('../../crons/weekly-reconcile')
      const reconcile = await runWeeklyReconcile()
      if (reconcile.skipped) {
        log.push(`Reconcile skipped: ${reconcile.reason}`)
      } else {
        log.push(
          `Reconcile: ${reconcile.inserted} inserted, ${reconcile.corrected} corrected, ${reconcile.projectsScanned} projects`,
        )
      }
    }

    log.push('Sync complete!')
    res.status(200).json({ ok: true, log })
  } catch (err) {
    console.error('Sync error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
