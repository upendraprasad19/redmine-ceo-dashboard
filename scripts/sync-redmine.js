/**
 * scripts/sync-redmine.js
 * Delta sync: only fetches records changed since last successful sync.
 * Falls back to 6-month window on first run.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import emailUtils from '../lib/email-utils.js';
const { normalizeEmail } = emailUtils;

const sql = neon(process.env.DATABASE_URL);

const REDMINE_URL = process.env.REDMINE_URL.replace(/\/$/, '');
const REDMINE_KEY = process.env.REDMINE_API_KEY;
const FALLBACK_DAYS = 182; // 6 months — used only on first run

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
    results = results.concat(data[key]);
    totalCount = data.total_count || 0;
    offset += limit;
    console.log(`  ${key}: fetched ${results.length} / ${totalCount}`);
  }
  return results;
}

// ── Sync state ────────────────────────────────────────────────────
async function getLastSyncedAt() {
  try {
    const rows = await sql`SELECT value FROM sync_state WHERE key = 'last_synced_at'`;
    if (rows.length > 0 && rows[0].value) return new Date(rows[0].value);
  } catch (_) {}
  return null;
}

async function setLastSyncedAt(date) {
  await sql`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES ('last_synced_at', ${date.toISOString()}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

// ── Memory caches ─────────────────────────────────────────────────
const userCache = new Map();    // redmine_id -> neon_id
const projectCache = new Map(); // redmine_id -> neon_id

async function getNeonUserId(u) {
  if (!u) return null;
  if (userCache.has(u.id)) return userCache.get(u.id);

  const existing = await sql`SELECT id FROM users WHERE redmine_id = ${u.id} LIMIT 1`;
  if (existing.length > 0) {
    userCache.set(u.id, existing[0].id);
    return existing[0].id;
  }

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

// ── Sync: Users ───────────────────────────────────────────────────
async function syncUsers() {
  console.log('\n👤 Syncing users...');
  try {
    const users = await fetchAll('/users', 'users', '&status=0');
    for (const u of users) {
      const initials = u.firstname && u.lastname ? `${u.firstname[0]}${u.lastname[0]}`.toUpperCase() : 'XX';
      const name = `${u.firstname || ''} ${u.lastname || ''}`.trim();
      const res = await sql`
        INSERT INTO users (redmine_id, name, email, initials, active)
        VALUES (${u.id}, ${name}, ${normalizeEmail(u.mail) || null}, ${initials}, true)
        ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()
        RETURNING id
      `;
      userCache.set(u.id, res[0].id);
    }
  } catch (e) {
    console.log('  ⚠️  User sync restricted. Will auto-create from issues.');
  }
}

// Approved project IDs (from AppScript)
const APPROVED_PROJECT_IDS = new Set([2,3,5,7,14,15,16,17,18,19,20,21,23,29,34,43,44,47,49,50,51,55,56,57,60,61,62,63,65,67,68,69,70,71,72,73,74,75,76]);

// Built at sync start: maps Delivery Owner enum value (as string) → Neon user id
// (Delivery Owner, custom field id 25, is an enumeration field — NOT a User field —
// so its values are internal enum IDs specific to this field, not Redmine user IDs.)
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
}

// ── Sync: Projects (only approved projects) ───────────────────────
async function syncProjects() {
  console.log('\n📁 Syncing approved projects only...');
  const projects = await fetchAll('/projects', 'projects');
  let count = 0;
  for (const p of projects) {
    if (!APPROVED_PROJECT_IDS.has(p.id)) continue;
    const res = await sql`
      INSERT INTO projects (redmine_id, name, description, status)
      VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
      ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
      RETURNING id
    `;
    projectCache.set(p.id, res[0].id);
    count++;
  }
  console.log(`  ✓ Synced ${count} approved projects`);
}

// ── Sync: Issues (delta by updated_on, only approved projects) ──
async function syncIssues(sinceDate) {
  console.log(`\n🎫 Syncing issues updated since ${sinceDate} (approved projects only)...`);
  const issues = await fetchAll(
    '/issues', 'issues',
    `&status_id=*&updated_on=>=${sinceDate}&sort=updated_on:desc`
  );

  // Filter to only approved projects
  const filtered = issues.filter(i => APPROVED_PROJECT_IDS.has(i.project?.id));

  if (filtered.length === 0) {
    console.log('  ✓ No new/changed issues in approved projects.');
    return;
  }

  const statusMap   = { 'New': 'New', 'In Progress': 'In Progress', 'Re Open': 'Re Open', 'Open': 'Open', 'Code Review': 'Review', 'Feedback': 'Closed', 'Blocked': 'Blocked', 'Resolved': 'Closed', 'Closed': 'Closed', 'Verified': 'Closed', 'Rejected': 'Closed' };
  const priorityMap = { 'Low': 'Low', 'Normal': 'Medium', 'High': 'High', 'Urgent': 'Critical', 'Immediate': 'Critical' };

  console.log(`\n⏳ Upserting ${filtered.length} issues...`);
  const chunkSize = 20;
  for (let i = 0; i < filtered.length; i += chunkSize) {
    const chunk = filtered.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (issue) => {
      const assigneeId = await getNeonUserId(issue.assigned_to);
      const authorId   = await getNeonUserId(issue.author);
      const projectId  = projectCache.get(issue.project?.id);
      const status     = statusMap[issue.status?.name] || issue.status?.name || 'Todo';
      const priority   = priorityMap[issue.priority?.name] || 'Medium';
      const bzField    = issue.custom_fields?.find(cf => cf.id === 9);
      const bzId       = bzField ? String(bzField.value) : null;

      // Delivery Owner custom field (id=25) — enumeration field (NOT User field).
      // Values are enum IDs specific to this field; use deliveryOwnerEnumToNeonId to resolve.
      const doField = issue.custom_fields?.find(cf => cf.id === 25);
      const doEnumVals = Array.isArray(doField?.value) ? doField.value : (doField?.value ? [doField.value] : []);
      const resolvedIds = doEnumVals.map(v => deliveryOwnerEnumToNeonId.get(String(v))).filter(Boolean);
      const deliveryOwnerIds = resolvedIds.length > 0 ? resolvedIds : null;

      await sql`
        INSERT INTO issues (redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, bz_id, delivery_owner_ids, start_date, due_date, done_ratio, closed_at, created_at, updated_at)
        VALUES (${issue.id}, ${projectId || null}, ${issue.subject}, ${issue.description || null}, ${status}, ${priority}, ${assigneeId}, ${authorId}, ${bzId}, ${deliveryOwnerIds}, ${issue.start_date || null}, ${issue.due_date || null}, ${issue.done_ratio || 0}, ${issue.closed_on || null}, ${issue.created_on}, ${issue.updated_on})
        ON CONFLICT (redmine_id) DO UPDATE SET status=EXCLUDED.status, priority=EXCLUDED.priority, assigned_to_id=EXCLUDED.assigned_to_id, bz_id=EXCLUDED.bz_id, delivery_owner_ids=EXCLUDED.delivery_owner_ids, done_ratio=EXCLUDED.done_ratio, due_date=EXCLUDED.due_date, closed_at=EXCLUDED.closed_at, updated_at=EXCLUDED.updated_at
      `;

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
        `;
      }
    }));
    if (i % 200 === 0) process.stdout.write('.');
  }
  console.log(`\n  ✓ ${issues.length} issues upserted`);
}

// ── Sync: Time Entries (delta with 14-day buffer, approved projects) ─
async function syncTimeEntries(sinceDate) {
  console.log(`\n⏱  Syncing time entries since ${sinceDate} (approved projects only)...`);
  const entries = await fetchAll('/time_entries', 'time_entries', `&spent_on=>=${sinceDate}`);
  // Filter to only approved projects
  const filtered = entries.filter(e => APPROVED_PROJECT_IDS.has(e.project?.id));

  if (filtered.length === 0) {
    console.log('  ✓ No new time entries in approved projects.');
    return;
  }

  console.log(`\n⏳ Upserting ${filtered.length} time entries...`);
  const chunkSize = 20;
  for (let i = 0; i < filtered.length; i += chunkSize) {
    const chunk = filtered.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (e) => {
      const userId    = await getNeonUserId(e.user);
      const projectId = projectCache.get(e.project?.id);
      const resIssue  = e.issue ? await sql`SELECT id FROM issues WHERE redmine_id = ${e.issue.id} LIMIT 1` : [];

      await sql`
        INSERT INTO time_entries (redmine_id, issue_id, user_id, project_id, hours, activity, comments, spent_on, created_at)
        VALUES (${e.id}, ${resIssue[0]?.id || null}, ${userId}, ${projectId || null}, ${e.hours}, ${e.activity?.name || null}, ${e.comments || null}, ${e.spent_on}, ${e.created_on})
        ON CONFLICT (redmine_id) DO UPDATE SET hours=EXCLUDED.hours, comments=EXCLUDED.comments
      `;
    }));
    if (i % 200 === 0) process.stdout.write('.');
  }
  console.log(`\n  ✓ ${filtered.length} time entries upserted`);
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const syncStartedAt = new Date();
  const isFullSync = process.argv.includes('--full');

  let issuesSince, timeEntriesSince;

  if (isFullSync) {
    // Full backfill — ignore last_synced_at
    const cutoff = new Date(Date.now() - FALLBACK_DAYS * 24 * 60 * 60 * 1000);
    issuesSince = cutoff.toISOString().split('T')[0];
    timeEntriesSince = issuesSince;
    console.log(`🚀 Full sync — backfilling since ${issuesSince}`);
  } else {
    // Delta — fetch only what changed since last sync
    const lastSyncedAt = await getLastSyncedAt();

    if (lastSyncedAt) {
      // 1-day buffer on issues to handle timezone edge cases
      const issuesCutoff = new Date(lastSyncedAt);
      issuesCutoff.setDate(issuesCutoff.getDate() - 1);
      issuesSince = issuesCutoff.toISOString().split('T')[0];

      // 14-day buffer on time entries (Redmine only has spent_on filter)
      const teCutoff = new Date(lastSyncedAt);
      teCutoff.setDate(teCutoff.getDate() - 14);
      timeEntriesSince = teCutoff.toISOString().split('T')[0];

      console.log(`🔄 Delta sync — last synced: ${lastSyncedAt.toISOString()}`);
    } else {
      // No prior state — fallback to FALLBACK_DAYS so the first sync is thorough
      const cutoff = new Date(Date.now() - FALLBACK_DAYS * 24 * 60 * 60 * 1000);
      issuesSince = cutoff.toISOString().split('T')[0];
      timeEntriesSince = issuesSince;
      console.log(`🔄 Delta sync — no prior state, fetching last ${FALLBACK_DAYS}d (${issuesSince})`);
    }
  }

  try {
    await syncUsers();
    await syncProjects();
    await buildDeliveryOwnerEnumMap();
    await syncIssues(issuesSince);
    await syncTimeEntries(timeEntriesSince);

    // Persist sync timestamp only on full success
    await setLastSyncedAt(syncStartedAt);
    console.log(`\n✅ Sync complete! Next delta will fetch changes since ${syncStartedAt.toISOString()}`);
  } catch (err) {
    console.error('\n❌ Sync failed:', err.message);
    process.exit(1);
  }
}

main();
