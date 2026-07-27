/**
 * crons/weekly-reconcile.js
 * Per-project full reconciliation: fetches ALL issues per approved project
 * from Redmine and corrects project_id / inserts missing issues.
 *
 * Piggybacks on daily `/api/sync` (runs at most once per 7 days).
 * CommonJS — loaded by `pages/api/sync.js`.
 */

const { neon } = require('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)

const REDMINE_URL = (process.env.REDMINE_URL || '').replace(/\/$/, '')
const REDMINE_KEY = process.env.REDMINE_API_KEY

const APPROVED = [
  2, 3, 5, 7, 14, 15, 16, 17, 18, 19, 20, 21, 23, 29, 34, 43, 44, 47, 49, 50, 51, 55, 56, 57, 60,
  61, 62, 63, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
]

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

const userCache = new Map()
const projectCache = new Map()

async function rf(path) {
  const url = `${REDMINE_URL}${path}${path.includes('?') ? '&' : '?'}key=${REDMINE_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Redmine ${res.status}`)
  return res.json()
}

async function fetchAll(endpoint, key, params = '') {
  let results = [],
    offset = 0,
    limit = 100,
    total = 1
  while (offset < total) {
    const data = await rf(`${endpoint}.json?limit=${limit}&offset=${offset}${params}`)
    results = results.concat(data[key] || [])
    total = data.total_count || 0
    offset += limit
  }
  return results
}

async function getNeonUserId(u) {
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
  const r = await sql`
    INSERT INTO users (redmine_id, name, initials, active)
    VALUES (${u.id}, ${u.name || 'Unknown'}, ${initials}, true)
    ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `
  userCache.set(u.id, r[0].id)
  return r[0].id
}

async function runWeeklyReconcile() {
  if (!REDMINE_URL || !REDMINE_KEY) return { skipped: true, reason: 'Redmine not configured' }

  // Check if 7+ days since last reconcile
  const rows = await sql`SELECT value FROM sync_state WHERE key = 'last_reconcile_at'`
  if (rows.length > 0) {
    const last = new Date(rows[0].value)
    if (Date.now() - last.getTime() < 7 * 24 * 60 * 60 * 1000) {
      return { skipped: true, reason: `Last reconcile ${last.toISOString()}, not due yet` }
    }
  }

  console.log('[weekly-reconcile] Starting...')
  const started = Date.now()
  let inserted = 0,
    corrected = 0,
    projectsScanned = 0

  // Build project cache (Redmine ID → Neon ID)
  projectCache.clear()
  const projects = await fetchAll('/projects', 'projects')
  const projectIdToNeon = {}
  for (const p of projects) {
    if (!APPROVED.includes(p.id)) continue
    const r = await sql`
      INSERT INTO projects (redmine_id, name, description, status)
      VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
      ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
      RETURNING id
    `
    projectCache.set(p.id, r[0].id)
    projectIdToNeon[p.id] = r[0].id
    projectsScanned++
  }

  // Fetch ALL issues for each approved project
  for (const redmineProjectId of APPROVED) {
    const neonProjectId = projectCache.get(redmineProjectId)
    if (!neonProjectId) continue

    const issues = await fetchAll(
      '/issues',
      'issues',
      `&project_id=${redmineProjectId}&status_id=*&created_on=>=2025-10-01&sort=id:asc`,
    )
    if (issues.length === 0) continue

    for (const issue of issues) {
      const existing = await sql`
        SELECT id, project_id, status FROM issues WHERE redmine_id = ${issue.id} LIMIT 1
      `

      if (existing.length === 0) {
        // Missing issue — insert it
        const assigneeId = await getNeonUserId(issue.assigned_to)
        const authorId = await getNeonUserId(issue.author)
        const status = statusMap[issue.status?.name] || issue.status?.name || 'New'
        const priority = priorityMap[issue.priority?.name] || 'Medium'
        const bzField = issue.custom_fields?.find((cf) => cf.id === 9)
        const doField = issue.custom_fields?.find((cf) => cf.id === 25)
        const _doEnumVals = Array.isArray(doField?.value)
          ? doField.value
          : doField?.value
            ? [doField.value]
            : []

        await sql`
          INSERT INTO issues (redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, bz_id, start_date, due_date, done_ratio, closed_at, created_at, updated_at)
          VALUES (${issue.id}, ${neonProjectId}, ${issue.subject}, ${issue.description || null}, ${status}, ${priority}, ${assigneeId}, ${authorId}, ${bzField ? String(bzField.value) : null}, ${issue.start_date || null}, ${issue.due_date || null}, ${issue.done_ratio || 0}, ${issue.closed_on || null}, ${issue.created_on}, ${issue.updated_on})
          ON CONFLICT (redmine_id) DO NOTHING
        `
        inserted++
      } else if (existing[0].project_id !== neonProjectId) {
        // Wrong project — correct it
        await sql`UPDATE issues SET project_id = ${neonProjectId}, updated_at = NOW() WHERE redmine_id = ${issue.id}`
        corrected++
      }
    }
  }

  // Record reconcile time
  await sql`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES ('last_reconcile_at', ${new Date().toISOString()}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `

  userCache.clear()
  projectCache.clear()

  const duration = Date.now() - started
  console.log(
    `[weekly-reconcile] Done: ${inserted} inserted, ${corrected} corrected, ${projectsScanned} projects in ${duration}ms`,
  )
  return { inserted, corrected, projectsScanned, duration_ms: duration }
}

module.exports = { runWeeklyReconcile }
