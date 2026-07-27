/**
 * scripts/backfill-do.js
 * Targeted backfill: re-fetches Delivery Owner (custom field 25) for ALL
 * active (non-closed) issues from Redmine and updates the DB.
 *
 * Usage:  node scripts/backfill-do.js
 */

import { config } from 'dotenv'

config({ path: '.env.local' })

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

const REDMINE_URL = (process.env.REDMINE_URL || '').replace(/\/$/, '')
const REDMINE_KEY = process.env.REDMINE_API_KEY

const APPROVED_REDMINE_IDS = [
  2, 3, 5, 7, 14, 15, 16, 17, 18, 19, 20, 21, 23, 29, 34, 43, 44, 47, 49, 50, 51, 55, 56, 57, 60,
  61, 62, 63, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
]

async function redmineFetch(path) {
  const url = `${REDMINE_URL}${path}${path.includes('?') ? '&' : '?'}key=${REDMINE_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Redmine API error: ${res.status}`)
  return res.json()
}

async function fetchProjectIssues(projectId) {
  let results = []
  let offset = 0
  const limit = 100
  let totalCount = 1
  while (offset < totalCount) {
    const data = await redmineFetch(
      `/issues.json?project_id=${projectId}&status_id=open&limit=${limit}&offset=${offset}`,
    )
    results = results.concat(data.issues || [])
    totalCount = data.total_count || 0
    offset += limit
  }
  return results
}

// ── Build Delivery Owner enum map ─────────────────────────────────
const deliveryOwnerEnumToNeonId = new Map()
async function buildDeliveryOwnerEnumMap() {
  console.log('Building Delivery Owner enum map...')
  const data = await redmineFetch('/custom_fields.json')
  const cf = (data.custom_fields || []).find((c) => c.id === 25)
  const pv = cf?.possible_values || []
  let resolved = 0
  for (const opt of pv) {
    const rows = await sql`SELECT id FROM users WHERE name = ${opt.label} LIMIT 1`
    if (rows.length > 0) {
      deliveryOwnerEnumToNeonId.set(String(opt.value), rows[0].id)
      resolved++
    }
  }
  console.log(`  ✓ ${resolved}/${pv.length} Delivery Owner enum values resolved`)
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  try {
    await buildDeliveryOwnerEnumMap()

    const dbProjects =
      await sql`SELECT redmine_id, name FROM projects WHERE redmine_id = ANY(${APPROVED_REDMINE_IDS}::int[])`
    console.log(`\nProcessing ${dbProjects.length} approved projects...`)

    let totalUpdated = 0
    let totalWithDO = 0
    let totalErrors = 0

    for (const proj of dbProjects) {
      let issues
      try {
        issues = await fetchProjectIssues(proj.redmine_id)
      } catch (e) {
        console.error(`  ✗ Project #${proj.redmine_id} (${proj.name}): ${e.message}`)
        totalErrors++
        continue
      }

      if (issues.length === 0) continue

      // Batch updates: collect DO data, then update in chunks
      const updates = issues.map((issue) => {
        const doField = issue.custom_fields?.find((cf) => cf.id === 25)
        const doEnumVals = Array.isArray(doField?.value)
          ? doField.value
          : doField?.value
            ? [doField.value]
            : []
        const resolvedIds = doEnumVals
          .map((v) => deliveryOwnerEnumToNeonId.get(String(v)))
          .filter(Boolean)
        return {
          redmineId: issue.id,
          deliveryOwnerIds: resolvedIds.length > 0 ? resolvedIds : null,
          assignedTo: issue.assigned_to,
        }
      })

      let projectUpdated = 0
      let projectWithDO = 0
      const chunkSize = 50

      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize)
        await Promise.all(
          chunk.map(async (u) => {
            try {
              await sql`
              UPDATE issues SET delivery_owner_ids = ${u.deliveryOwnerIds}
              WHERE redmine_id = ${u.redmineId}
            `
              projectUpdated++
              if (u.deliveryOwnerIds) projectWithDO++
            } catch (_e) {
              totalErrors++
            }

            // Sync issue_team_history
            if (u.assignedTo) {
              try {
                const uRows =
                  await sql`SELECT id, team FROM users WHERE redmine_id = ${u.assignedTo.id} LIMIT 1`
                if (uRows.length > 0 && uRows[0].team) {
                  const iRows =
                    await sql`SELECT id FROM issues WHERE redmine_id = ${u.redmineId} LIMIT 1`
                  if (iRows.length > 0) {
                    await sql`
                    INSERT INTO issue_team_history (issue_id, team_name, user_id, assigned_at)
                    VALUES (${iRows[0].id}, ${uRows[0].team}, ${uRows[0].id}, NOW())
                    ON CONFLICT (issue_id, team_name) DO UPDATE SET user_id=EXCLUDED.user_id, assigned_at=EXCLUDED.assigned_at
                  `
                  }
                }
              } catch (_) {}
            }
          }),
        )
        process.stdout.write('.')
      }

      totalUpdated += projectUpdated
      totalWithDO += projectWithDO
      console.log(` ${proj.name}: ${projectUpdated} issues (${projectWithDO} with DO)`)
    }

    console.log(`\n  ✓ ${totalUpdated} total issues processed`)
    console.log(`    ${totalWithDO} with Delivery Owner assigned`)
    console.log(`    ${totalUpdated - totalWithDO} without Delivery Owner`)
    if (totalErrors > 0) console.log(`    ${totalErrors} errors`)

    // Update sync state
    await sql`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES ('last_synced_at', ${new Date().toISOString()}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `
    console.log('\n✅ Sync state updated. Backfill complete!')
  } catch (err) {
    console.error('\n❌ Backfill failed:', err.message)
    process.exit(1)
  }
}

main()
