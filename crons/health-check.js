/**
 * crons/health-check.js
 *
 * Weekly source-of-truth (SOT) / read-write drift audit for the Redmine CEO
 * Dashboard. Implements the 6 checks described in .opencode/AGENTS.md
 * §DB audit / SOT drift check protocol.
 *
 * Reuses existing clients only:
 *   - lib/db.js (neon)        — local cache reads
 *   - lib/redmine.js          — Redmine REST API (GET only)
 *
 * Entry point: runHealthCheck() — returns a JSON-serializable drift report and
 * logs warnings for every exceeded threshold. No writes, no side effects.
 *
 * Dispatched by pages/api/cron/run.js (JOB_MAP 'health-check') and scheduled
 * weekly via vercel.json (0 4 * * 1).
 */

// Approved Redmine project IDs — mirrored from scripts/sync-redmine.js so this
// standalone cron module keeps require semantics free of ESM neighbours.
const APPROVED_PROJECT_IDS = [
  2, 3, 5, 7, 14, 15, 16, 17, 18, 19, 20, 21, 23, 29, 34, 43, 44, 47, 49, 50, 51, 55, 56, 57, 60,
  61, 62, 63, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
]

// Drift thresholds from the protocol.
const ISSUE_DRIFT_PCT = 5 // >5% difference flagged
const USER_DRIFT_PCT = 5 // >5% difference flagged
const TIME_DRIFT_HOURS = 2 // >2h difference flagged
const SYNC_STALE_HOURS = 24 // >24h stale warned

async function runHealthCheck() {
  const { getDb } = require('../lib/db')
  const redmine = require('../lib/redmine')
  const sql = getDb()

  const report = {
    checkedAt: new Date().toISOString(),
    checks: {},
    warnings: [],
  }

  const warn = (code, message, detail) => {
    report.warnings.push({ code, message, detail })
    console.warn(`[HEALTH-CHECK] ⚠️ ${code}: ${message}`)
  }

  // ── 1. Redmine count check ───────────────────────────────────────
  try {
    const projects = await redmine.getProjects()
    report.checks.redmineResponsive = {
      ok: true,
      projectCount: projects ? projects.length : 0,
    }
  } catch (err) {
    report.checks.redmineResponsive = { ok: false, error: err.message }
    warn('REDMINE_UNREACHABLE', 'Redmine API did not respond', err.message)
  }

  // ── 2. Issue count drift ─────────────────────────────────────────
  try {
    const dbIssues = await sql`
      SELECT COUNT(*)::int AS c FROM issues
      WHERE project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_PROJECT_IDS}::int[]))
    `
    const dbCount = Number(dbIssues[0].c)

    // Redmine open issues for approved projects (paginated, capped at 100 pages).
    let redmineCount = 0
    let offset = 0
    const limit = 100
    for (let page = 0; page < 100; page++) {
      const issues = await redmine.getTickets({
        status: 'open',
        limit,
        offset,
      })
      const approved = (issues || []).filter((i) => APPROVED_PROJECT_IDS.includes(i.project?.id))
      redmineCount += approved.length
      offset += limit
      if (!issues || issues.length < limit) break
    }

    const diff = Math.abs(dbCount - redmineCount)
    const pct = dbCount > 0 ? (diff / dbCount) * 100 : redmineCount > 0 ? 100 : 0
    const drifted = pct > ISSUE_DRIFT_PCT
    report.checks.issueDrift = {
      dbCount,
      redmineCount,
      diff,
      pct: Number(pct.toFixed(2)),
      thresholdPct: ISSUE_DRIFT_PCT,
      drifted,
    }
    if (drifted) {
      warn('ISSUE_DRIFT', `Issue count differs ${pct.toFixed(2)}% (>${ISSUE_DRIFT_PCT}%)`, {
        dbCount,
        redmineCount,
      })
    }
  } catch (err) {
    report.checks.issueDrift = { error: err.message }
    warn('ISSUE_DRIFT_FAILED', 'Issue drift check failed', err.message)
  }

  // ── 3. Delivery Owner drift ──────────────────────────────────────
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS c FROM issues
      WHERE (delivery_owner_ids IS NULL OR array_length(delivery_owner_ids, 1) = 0)
        AND status NOT IN ('Closed', 'Resolved')
        AND project_id IN (SELECT id FROM projects WHERE redmine_id = ANY(${APPROVED_PROJECT_IDS}::int[]))
    `
    const missing = Number(rows[0].c)
    report.checks.deliveryOwnerDrift = { missingOwnerCount: missing, expectedNearZero: true }
    if (missing > 0) {
      warn('DELIVERY_OWNER_DRIFT', `${missing} open issues have no resolved Delivery Owner`, {
        missing,
      })
    }
  } catch (err) {
    report.checks.deliveryOwnerDrift = { error: err.message }
    warn('DELIVERY_OWNER_FAILED', 'Delivery Owner check failed', err.message)
  }

  // ── 4. Sync staleness ────────────────────────────────────────────
  try {
    const rows = await sql`
      SELECT value FROM sync_state WHERE key = 'last_synced_at' LIMIT 1
    `
    const lastSynced = rows[0] ? rows[0].value : null
    let stale = true
    let hoursSince = null
    if (lastSynced) {
      const then = new Date(lastSynced).getTime()
      hoursSince = (Date.now() - then) / 36e5
      stale = hoursSince > SYNC_STALE_HOURS
    }
    report.checks.syncStaleness = {
      lastSyncedAt: lastSynced,
      hoursSince: hoursSince === null ? null : Number(hoursSince.toFixed(2)),
      thresholdHours: SYNC_STALE_HOURS,
      stale,
    }
    if (stale) {
      warn(
        'SYNC_STALE',
        `Last sync ${hoursSince === null ? 'never' : `${hoursSince.toFixed(1)}h`} ago (>${SYNC_STALE_HOURS}h)`,
        { lastSyncedAt: lastSynced },
      )
    }
  } catch (err) {
    report.checks.syncStaleness = { error: err.message }
    warn('SYNC_STALE_FAILED', 'Sync staleness check failed', err.message)
  }

  // ── 5. User sync drift ───────────────────────────────────────────
  try {
    const dbUsers = await sql`SELECT COUNT(*)::int AS c FROM users`
    const dbCount = Number(dbUsers[0].c)
    const redmineUsers = await redmine.getUsers()
    const redmineCount = redmineUsers ? redmineUsers.length : 0

    const diff = Math.abs(dbCount - redmineCount)
    const pct = dbCount > 0 ? (diff / dbCount) * 100 : redmineCount > 0 ? 100 : 0
    const drifted = pct > USER_DRIFT_PCT
    report.checks.userDrift = {
      dbCount,
      redmineCount,
      diff,
      pct: Number(pct.toFixed(2)),
      thresholdPct: USER_DRIFT_PCT,
      drifted,
    }
    if (drifted) {
      warn('USER_DRIFT', `User count differs ${pct.toFixed(2)}% (>${USER_DRIFT_PCT}%)`, {
        dbCount,
        redmineCount,
      })
    }
  } catch (err) {
    report.checks.userDrift = { error: err.message }
    warn('USER_DRIFT_FAILED', 'User drift check failed', err.message)
  }

  // ── 6. Time entry drift (last 7 days) ────────────────────────────
  try {
    const to = new Date().toISOString().split('T')[0]
    const from = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]

    const dbRows = await sql`
      SELECT COALESCE(SUM(hours), 0)::float AS h FROM time_entries
      WHERE spent_on >= ${from} AND spent_on <= ${to}
    `
    const dbHours = Number(dbRows[0].h)

    const entries = await redmine.getTimeEntries({ from, to, limit: 100 })
    const redmineHours = (entries || []).reduce((sum, e) => sum + (Number(e.hours) || 0), 0)

    const diff = Math.abs(dbHours - redmineHours)
    const drifted = diff > TIME_DRIFT_HOURS
    report.checks.timeEntryDrift = {
      from,
      to,
      dbHours: Number(dbHours.toFixed(2)),
      redmineHours: Number(redmineHours.toFixed(2)),
      diffHours: Number(diff.toFixed(2)),
      thresholdHours: TIME_DRIFT_HOURS,
      drifted,
    }
    if (drifted) {
      warn('TIME_DRIFT', `Time entry hours differ ${diff.toFixed(2)}h (>${TIME_DRIFT_HOURS}h)`, {
        dbHours,
        redmineHours,
      })
    }
  } catch (err) {
    report.checks.timeEntryDrift = { error: err.message }
    warn('TIME_DRIFT_FAILED', 'Time entry drift check failed', err.message)
  }

  report.warningCount = report.warnings.length
  report.healthy = report.warnings.length === 0
  console.log(`[HEALTH-CHECK] Done. ${report.warningCount} warning(s).`)
  return report
}

module.exports = { runHealthCheck }
