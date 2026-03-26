/**
 * scripts/sync-redmine.js
 * Delta sync: only fetches records changed since last successful sync.
 * Falls back to 6-month window on first run.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

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
        VALUES (${u.id}, ${name}, ${u.mail || null}, ${initials}, true)
        ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()
        RETURNING id
      `;
      userCache.set(u.id, res[0].id);
    }
  } catch (e) {
    console.log('  ⚠️  User sync restricted. Will auto-create from issues.');
  }
}

// ── Sync: Projects (always full — only 80, negligible cost) ───────
async function syncProjects() {
  console.log('\n📁 Syncing projects...');
  const projects = await fetchAll('/projects', 'projects');
  for (const p of projects) {
    const res = await sql`
      INSERT INTO projects (redmine_id, name, description, status)
      VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
      ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
      RETURNING id
    `;
    projectCache.set(p.id, res[0].id);
  }
}

// ── Sync: Issues (delta by updated_on) ───────────────────────────
async function syncIssues(sinceDate) {
  console.log(`\n🎫 Syncing issues updated since ${sinceDate}...`);
  const issues = await fetchAll(
    '/issues', 'issues',
    `&status_id=*&updated_on=>=${sinceDate}&sort=updated_on:desc`
  );

  if (issues.length === 0) {
    console.log('  ✓ No new/changed issues.');
    return;
  }

  const statusMap   = { 'New': 'Todo', 'In Progress': 'In Progress', 'Code Review': 'Review', 'Blocked': 'Blocked', 'Resolved': 'Closed', 'Closed': 'Closed', 'Feedback': 'Review' };
  const priorityMap = { 'Low': 'Low', 'Normal': 'Medium', 'High': 'High', 'Urgent': 'Critical', 'Immediate': 'Critical' };

  console.log(`\n⏳ Upserting ${issues.length} issues...`);
  const chunkSize = 20;
  for (let i = 0; i < issues.length; i += chunkSize) {
    const chunk = issues.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (issue) => {
      const assigneeId = await getNeonUserId(issue.assigned_to);
      const authorId   = await getNeonUserId(issue.author);
      const projectId  = projectCache.get(issue.project?.id);
      const status     = statusMap[issue.status?.name] || issue.status?.name || 'Todo';
      const priority   = priorityMap[issue.priority?.name] || 'Medium';
      const bzField    = issue.custom_fields?.find(cf => cf.id === 9);
      const bzId       = bzField ? String(bzField.value) : null;

      await sql`
        INSERT INTO issues (redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, bz_id, start_date, due_date, done_ratio, closed_at, created_at, updated_at)
        VALUES (${issue.id}, ${projectId || null}, ${issue.subject}, ${issue.description || null}, ${status}, ${priority}, ${assigneeId}, ${authorId}, ${bzId}, ${issue.start_date || null}, ${issue.due_date || null}, ${issue.done_ratio || 0}, ${issue.closed_on || null}, ${issue.created_on}, ${issue.updated_on})
        ON CONFLICT (redmine_id) DO UPDATE SET status=EXCLUDED.status, priority=EXCLUDED.priority, assigned_to_id=EXCLUDED.assigned_to_id, bz_id=EXCLUDED.bz_id, done_ratio=EXCLUDED.done_ratio, due_date=EXCLUDED.due_date, closed_at=EXCLUDED.closed_at, updated_at=EXCLUDED.updated_at
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

// ── Sync: Time Entries (delta with 14-day safety buffer) ──────────
// Redmine time_entries API only supports spent_on filter (no updated_on).
// We buffer 14 days back from last sync to catch retroactively logged time.
async function syncTimeEntries(sinceDate) {
  console.log(`\n⏱  Syncing time entries since ${sinceDate} (14-day buffer)...`);
  const entries = await fetchAll('/time_entries', 'time_entries', `&spent_on=>=${sinceDate}`);

  if (entries.length === 0) {
    console.log('  ✓ No new time entries.');
    return;
  }

  console.log(`\n⏳ Upserting ${entries.length} time entries...`);
  const chunkSize = 20;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
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
  console.log(`\n  ✓ ${entries.length} time entries upserted`);
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
      // No prior state — safe fallback: last 24 hours only
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      issuesSince = yesterday.toISOString().split('T')[0];
      timeEntriesSince = issuesSince;
      console.log(`🔄 Delta sync — no prior state, fetching last 24h (${issuesSince})`);
    }
  }

  try {
    await syncUsers();
    await syncProjects();
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
