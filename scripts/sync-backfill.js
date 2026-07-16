/**
 * scripts/sync-backfill.js
 * One-time historical backfill: fetches all approved-project tickets created
 * since Oct 1 2025 using created_on (not updated_on), so stale tickets that
 * the delta sync keeps missing are brought in.
 *
 * Usage: node scripts/sync-backfill.js
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const REDMINE_URL = process.env.REDMINE_URL.replace(/\/$/, '');
const REDMINE_KEY = process.env.REDMINE_API_KEY;
const START_DATE  = '2025-10-01';

const APPROVED_PROJECT_IDS = new Set([2,3,5,7,14,15,16,17,18,19,20,21,23,29,34,43,44,47,49,50,51,55,56,57,60,61,62,63,65,67,68,69,70,71,72,73,74,75,76]);

const statusMap   = { 'New': 'New', 'In Progress': 'In Progress', 'Re Open': 'Re Open', 'Open': 'Open', 'Code Review': 'Review', 'Feedback': 'Closed', 'Blocked': 'Blocked', 'Resolved': 'Closed', 'Closed': 'Closed', 'Verified': 'Closed', 'Rejected': 'Closed' };
const priorityMap = { 'Low': 'Low', 'Normal': 'Medium', 'High': 'High', 'Urgent': 'Critical', 'Immediate': 'Critical' };

// Delivery Owner enumeration (custom field id=25) — values are enum IDs, not user IDs
const deliveryOwnerEnumToNeonId = new Map();
async function buildDeliveryOwnerEnumMap() {
  const res = await fetch(`${REDMINE_URL}/custom_fields.json?key=${REDMINE_KEY}`);
  if (!res.ok) { console.log('  ⚠️  Cannot fetch custom_fields; Delivery Owner will be empty'); return; }
  const data = await res.json();
  const cf = (data.custom_fields || []).find(c => c.id === 25);
  const pv = cf?.possible_values || [];
  for (const opt of pv) {
    const rows = await sql`SELECT id FROM users WHERE name = ${opt.label} LIMIT 1`;
    if (rows.length > 0) deliveryOwnerEnumToNeonId.set(String(opt.value), rows[0].id);
  }
  console.log(`  ✓ Delivery Owner enum map: ${deliveryOwnerEnumToNeonId.size}/${pv.length} resolved`);
  pv.forEach(opt => console.log(`    ${opt.value} → ${opt.label} ${deliveryOwnerEnumToNeonId.has(String(opt.value)) ? '✓' : '(no match)'}`));
}

async function redmineFetch(path) {
  const url = `${REDMINE_URL}${path}${path.includes('?') ? '&' : '?'}key=${REDMINE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Redmine API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchAll(endpoint, key, params = '') {
  let results = [];
  let offset = 0;
  const limit = 100;
  let totalCount = 1;
  while (offset < totalCount) {
    const data = await redmineFetch(`${endpoint}.json?limit=${limit}&offset=${offset}${params}`);
    results = results.concat(data[key] || []);
    totalCount = data.total_count || 0;
    offset += limit;
    process.stdout.write(`  ${key}: ${results.length}/${totalCount}\r`);
  }
  console.log();
  return results;
}

const userCache    = new Map();
const projectCache = new Map(); // Redmine ID → Neon ID

async function getNeonUserId(u) {
  if (!u) return null;
  if (userCache.has(u.id)) return userCache.get(u.id);
  const existing = await sql`SELECT id FROM users WHERE redmine_id = ${u.id} LIMIT 1`;
  if (existing.length > 0) { userCache.set(u.id, existing[0].id); return existing[0].id; }
  const initials = u.name ? u.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'XX';
  const res = await sql`
    INSERT INTO users (redmine_id, name, initials, active)
    VALUES (${u.id}, ${u.name || 'Unknown'}, ${initials}, true)
    ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  userCache.set(u.id, res[0].id);
  return res[0].id;
}

async function buildProjectCache() {
  console.log('\n📁 Building project cache (Redmine ID → Neon ID)...');
  const projects = await fetchAll('/projects', 'projects');
  for (const p of projects) {
    if (!APPROVED_PROJECT_IDS.has(p.id)) continue;
    const res = await sql`
      INSERT INTO projects (redmine_id, name, description, status)
      VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
      ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
      RETURNING id
    `;
    projectCache.set(p.id, res[0].id);
  }
  console.log(`  ✓ ${projectCache.size} approved projects cached`);
}

async function backfillProject(redmineProjectId, projectName) {
  console.log(`\n🎫 Backfilling: ${projectName} (Redmine #${redmineProjectId})...`);
  const issues = await fetchAll(
    '/issues', 'issues',
    `&project_id=${redmineProjectId}&status_id=*&created_on=>=${START_DATE}&sort=created_on:asc`
  );

  if (issues.length === 0) {
    console.log('  ✓ No issues to backfill.');
    return 0;
  }

  const neonProjectId = projectCache.get(redmineProjectId);
  let upserted = 0;

  const chunkSize = 20;
  for (let i = 0; i < issues.length; i += chunkSize) {
    const chunk = issues.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (issue) => {
      const assigneeId = await getNeonUserId(issue.assigned_to);
      const authorId   = await getNeonUserId(issue.author);
      const status     = statusMap[issue.status?.name] || issue.status?.name || 'New';
      const priority   = priorityMap[issue.priority?.name] || 'Medium';
      const bzField    = issue.custom_fields?.find(cf => cf.id === 9);
      const bzId       = bzField ? String(bzField.value) : null;

      // Delivery Owner custom field (id=25) — enumeration field. Values are enum IDs,
      // mapped via deliveryOwnerEnumToNeonId (label-based match to users.name).
      const doField = issue.custom_fields?.find(cf => cf.id === 25);
      const doEnumVals = Array.isArray(doField?.value) ? doField.value : (doField?.value ? [doField.value] : []);
      const resolvedIds = doEnumVals.map(v => deliveryOwnerEnumToNeonId.get(String(v))).filter(Boolean);
      const deliveryOwnerIds = resolvedIds.length > 0 ? resolvedIds : null;

      await sql`
        INSERT INTO issues (redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, bz_id, delivery_owner_ids, start_date, due_date, done_ratio, closed_at, created_at, updated_at)
        VALUES (${issue.id}, ${neonProjectId || null}, ${issue.subject}, ${issue.description || null}, ${status}, ${priority}, ${assigneeId}, ${authorId}, ${bzId}, ${deliveryOwnerIds}, ${issue.start_date || null}, ${issue.due_date || null}, ${issue.done_ratio || 0}, ${issue.closed_on || null}, ${issue.created_on}, ${issue.updated_on})
        ON CONFLICT (redmine_id) DO UPDATE SET
          status=EXCLUDED.status, priority=EXCLUDED.priority,
          assigned_to_id=EXCLUDED.assigned_to_id, bz_id=EXCLUDED.bz_id,
          delivery_owner_ids=EXCLUDED.delivery_owner_ids,
          done_ratio=EXCLUDED.done_ratio, due_date=EXCLUDED.due_date,
          closed_at=EXCLUDED.closed_at, updated_at=EXCLUDED.updated_at,
          project_id=EXCLUDED.project_id
      `;

      if (assigneeId) {
        await sql`
          WITH issue_data AS (
            SELECT i.id AS neon_issue_id, u.team AS team_name, u.id AS neon_user_id
            FROM issues i JOIN users u ON u.id = i.assigned_to_id
            WHERE i.redmine_id = ${issue.id} AND u.team IS NOT NULL
          )
          INSERT INTO issue_team_history (issue_id, team_name, user_id, assigned_at)
          SELECT neon_issue_id, team_name, neon_user_id, NOW()
          FROM issue_data
          ON CONFLICT (issue_id, team_name) DO UPDATE SET user_id=EXCLUDED.user_id, assigned_at=EXCLUDED.assigned_at
        `;
      }
      upserted++;
    }));
    process.stdout.write(`  progress: ${Math.min(i + chunkSize, issues.length)}/${issues.length}\r`);
  }
  console.log(`\n  ✓ ${upserted} issues upserted for ${projectName}`);
  return upserted;
}

async function main() {
  try {
    await buildProjectCache();
    await buildDeliveryOwnerEnumMap();

    let totalUpserted = 0;
    for (const [redmineId, neonId] of projectCache) {
      // Only backfill projects — get project name from DB
      const proj = await sql`SELECT name FROM projects WHERE id = ${neonId} LIMIT 1`;
      const name = proj[0]?.name || `Project ${redmineId}`;
      const count = await backfillProject(redmineId, name);
      totalUpserted += count;
    }

    // Final verification
    const after = await sql`
      SELECT p.name, COUNT(i.id)::int AS total,
        SUM(CASE WHEN i.status NOT IN ('Closed','Resolved','Verified','Rejected') THEN 1 ELSE 0 END)::int AS active
      FROM projects p
      JOIN issues i ON i.project_id = p.id
      WHERE p.redmine_id IN (73, 14, 15, 47, 76)
      GROUP BY p.name ORDER BY active DESC
    `;
    console.log('\n=== POST-BACKFILL COUNTS (key projects) ===');
    after.forEach(r => console.log(`${r.name}: ${r.total} total, ${r.active} active`));
    console.log(`\n✅ Backfill complete — ${totalUpserted} issues processed`);

  } catch (err) {
    console.error('\n❌ Backfill failed:', err.message);
    process.exit(1);
  }
}

main();
