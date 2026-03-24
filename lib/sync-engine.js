/**
 * lib/sync-engine.js
 *
 * Core Redmine → Neon sync logic.
 * Supports two modes:
 *   full  — fetches last 6 months of everything (used by daily 1AM cron)
 *   delta — fetches only records changed since last sync (used by 10-min cron)
 *
 * Imported by pages/api/sync.js (Vercel serverless) and scripts/sync-redmine.js (local CLI).
 */

const REDMINE_URL = () => (process.env.REDMINE_URL || '').replace(/\/$/, '');
const REDMINE_KEY = () => process.env.REDMINE_API_KEY;

// How far back the full sync reaches
const FULL_SYNC_DAYS = 182; // 6 months

// For delta time entries: Redmine has no updated_on filter on time_entries,
// so we re-fetch the last N days of spent_on dates as a safe window.
const DELTA_TIME_ENTRY_DAYS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Redmine API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function redmineFetch(path) {
  const base = REDMINE_URL();
  const key  = REDMINE_KEY();
  const url  = `${base}${path}${path.includes('?') ? '&' : '?'}key=${key}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Redmine ${res.status}: ${path}`);
  return res.json();
}

async function fetchAll(endpoint, key, params = '', log) {
  const results = [];
  let offset = 0;
  const limit = 100;
  let total = 1;

  while (offset < total) {
    const data = await redmineFetch(`${endpoint}.json?limit=${limit}&offset=${offset}${params}`);
    results.push(...(data[key] || []));
    total = data.total_count || 0;
    offset += limit;
    if (log) log(`  ${key}: ${results.length} / ${total}`);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildCaches(sql) {
  const userCache    = new Map(); // redmine_id → neon id
  const projectCache = new Map(); // redmine_id → neon id

  async function getNeonUserId(u) {
    if (!u) return null;
    if (userCache.has(u.id)) return userCache.get(u.id);
    const rows = await sql`SELECT id FROM users WHERE redmine_id = ${u.id} LIMIT 1`;
    if (rows.length) { userCache.set(u.id, rows[0].id); return rows[0].id; }
    const initials = u.name ? u.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'XX';
    const ins = await sql`
      INSERT INTO users (redmine_id, name, initials, active)
      VALUES (${u.id}, ${u.name || 'Unknown'}, ${initials}, true)
      ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    userCache.set(u.id, ins[0].id);
    return ins[0].id;
  }

  async function getNeonProjectId(p) {
    if (!p) return null;
    if (projectCache.has(p.id)) return projectCache.get(p.id);
    const rows = await sql`SELECT id FROM projects WHERE redmine_id = ${p.id} LIMIT 1`;
    if (rows.length) { projectCache.set(p.id, rows[0].id); return rows[0].id; }
    return null;
  }

  return { userCache, projectCache, getNeonUserId, getNeonProjectId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync: Users (full only — user list rarely changes)
// ─────────────────────────────────────────────────────────────────────────────

async function syncUsers(sql, { userCache, log }) {
  log('👤 Syncing users...');
  try {
    const active = await fetchAll('/users', 'users', '&status=1', log);
    const locked = await fetchAll('/users', 'users', '&status=3', log);
    const all = [
      ...active.map(u => ({ ...u, _active: true })),
      ...locked.map(u => ({ ...u, _active: false })),
    ];
    for (const u of all) {
      const initials = u.firstname && u.lastname
        ? `${u.firstname[0]}${u.lastname[0]}`.toUpperCase() : 'XX';
      const name = `${u.firstname || ''} ${u.lastname || ''}`.trim();
      const res = await sql`
        INSERT INTO users (redmine_id, name, email, initials, active)
        VALUES (${u.id}, ${name}, ${u.mail || null}, ${initials}, ${u._active})
        ON CONFLICT (redmine_id) DO UPDATE
          SET name = EXCLUDED.name, email = EXCLUDED.email,
              active = EXCLUDED.active, updated_at = NOW()
        RETURNING id
      `;
      userCache.set(u.id, res[0].id);
    }
    log(`  ✓ ${all.length} users`);
    return { added: all.length, updated: 0 };
  } catch (e) {
    log('  ⚠️  User sync restricted — will auto-create from issues');
    return { added: 0, updated: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync: Projects (full only — projects rarely change)
// ─────────────────────────────────────────────────────────────────────────────

async function syncProjects(sql, { projectCache, log }) {
  log('📁 Syncing projects...');
  const projects = await fetchAll('/projects', 'projects', '', log);
  for (const p of projects) {
    const res = await sql`
      INSERT INTO projects (redmine_id, name, description, status)
      VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
      ON CONFLICT (redmine_id) DO UPDATE
        SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
      RETURNING id
    `;
    projectCache.set(p.id, res[0].id);
  }
  log(`  ✓ ${projects.length} projects`);
  return { added: projects.length, updated: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync: Issues
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_MAP   = { 'New':'Todo','In Progress':'In Progress','Code Review':'Review','Blocked':'Blocked','Resolved':'Closed','Closed':'Closed','Feedback':'Review' };
const PRIORITY_MAP = { 'Low':'Low','Normal':'Medium','High':'High','Urgent':'Critical','Immediate':'Critical' };

async function syncIssues(sql, { getNeonUserId, getNeonProjectId }, sinceDate, log) {
  const dateStr = typeof sinceDate === 'string' ? sinceDate : sinceDate.toISOString().split('T')[0];
  log(`🎫 Syncing issues updated since ${dateStr}...`);

  const issues = await fetchAll(
    '/issues', 'issues',
    `&status_id=*&updated_on=>=${dateStr}&sort=updated_on:desc`,
    log
  );

  log(`  Processing ${issues.length} issues...`);
  const chunkSize = 20;
  for (let i = 0; i < issues.length; i += chunkSize) {
    await Promise.all(issues.slice(i, i + chunkSize).map(async issue => {
      const assigneeId  = await getNeonUserId(issue.assigned_to);
      const authorId    = await getNeonUserId(issue.author);
      const projectId   = await getNeonProjectId(issue.project);
      const status      = STATUS_MAP[issue.status?.name]   || issue.status?.name   || 'Todo';
      const priority    = PRIORITY_MAP[issue.priority?.name] || 'Medium';
      const bzField     = issue.custom_fields?.find(cf => cf.id === 9);
      const bzId        = bzField ? String(bzField.value) : null;

      await sql`
        INSERT INTO issues
          (redmine_id, project_id, title, description, status, priority,
           assigned_to_id, author_id, bz_id, start_date, due_date,
           done_ratio, closed_at, created_at, updated_at)
        VALUES
          (${issue.id}, ${projectId || null}, ${issue.subject}, ${issue.description || null},
           ${status}, ${priority}, ${assigneeId}, ${authorId}, ${bzId},
           ${issue.start_date || null}, ${issue.due_date || null},
           ${issue.done_ratio || 0}, ${issue.closed_on || null},
           ${issue.created_on}, ${issue.updated_on})
        ON CONFLICT (redmine_id) DO UPDATE SET
          status         = EXCLUDED.status,
          priority       = EXCLUDED.priority,
          assigned_to_id = EXCLUDED.assigned_to_id,
          bz_id          = EXCLUDED.bz_id,
          done_ratio     = EXCLUDED.done_ratio,
          due_date       = EXCLUDED.due_date,
          closed_at      = EXCLUDED.closed_at,
          updated_at     = EXCLUDED.updated_at
      `;

      // Track team assignment history
      if (assigneeId) {
        await sql`
          WITH issue_data AS (
            SELECT i.id AS neon_issue_id, u.team AS team_name, u.id AS neon_user_id
            FROM issues i JOIN users u ON u.id = i.assigned_to_id
            WHERE i.redmine_id = ${issue.id} AND u.team IS NOT NULL
          )
          INSERT INTO issue_team_history (issue_id, team_name, user_id, assigned_at)
          SELECT neon_issue_id, team_name, neon_user_id, NOW() FROM issue_data
          ON CONFLICT (issue_id, team_name)
            DO UPDATE SET user_id = EXCLUDED.user_id, assigned_at = EXCLUDED.assigned_at
        `;
      }
    }));
  }
  log(`  ✓ ${issues.length} issues synced`);
  return { added: issues.length, updated: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync: Time Entries
// ─────────────────────────────────────────────────────────────────────────────

async function syncTimeEntries(sql, { getNeonUserId, getNeonProjectId }, fromDate, log) {
  const dateStr = typeof fromDate === 'string' ? fromDate : fromDate.toISOString().split('T')[0];
  log(`⏱  Syncing time entries from ${dateStr}...`);

  const entries = await fetchAll('/time_entries', 'time_entries', `&spent_on=>=${dateStr}`, log);

  log(`  Processing ${entries.length} entries...`);
  const chunkSize = 20;
  for (let i = 0; i < entries.length; i += chunkSize) {
    await Promise.all(entries.slice(i, i + chunkSize).map(async e => {
      const userId    = await getNeonUserId(e.user);
      const projectId = await getNeonProjectId(e.project);
      const issueRows = e.issue
        ? await sql`SELECT id FROM issues WHERE redmine_id = ${e.issue.id} LIMIT 1`
        : [];

      await sql`
        INSERT INTO time_entries
          (redmine_id, issue_id, user_id, project_id, hours, activity, comments, spent_on, created_at)
        VALUES
          (${e.id}, ${issueRows[0]?.id || null}, ${userId}, ${projectId || null},
           ${e.hours}, ${e.activity?.name || null}, ${e.comments || null},
           ${e.spent_on}, ${e.created_on})
        ON CONFLICT (redmine_id) DO UPDATE SET
          hours    = EXCLUDED.hours,
          comments = EXCLUDED.comments
      `;
    }));
  }
  log(`  ✓ ${entries.length} time entries synced`);
  return { added: entries.length, updated: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// sync_log helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getLastSynced(sql, entity) {
  const rows = await sql`
    SELECT last_synced FROM sync_log
    WHERE entity = ${entity} AND status = 'ok'
    ORDER BY last_synced DESC LIMIT 1
  `;
  return rows[0]?.last_synced || null;
}

async function writeSyncLog(sql, entity, counts, status = 'ok', error = null) {
  await sql`
    INSERT INTO sync_log (entity, last_synced, records_added, records_updated, status, error)
    VALUES (${entity}, NOW(), ${counts.added}, ${counts.updated}, ${status}, ${error})
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: runSync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} mode  'full' | 'delta'
 * @param {Function} sql  Neon tagged-template sql function
 * @param {Function} [logger]  optional log fn, defaults to console.log
 */
export async function runSync(mode, sql, logger) {
  const log = logger || (msg => console.log(msg));
  const startedAt = Date.now();

  log(`\n🚀 Starting ${mode.toUpperCase()} sync — ${new Date().toISOString()}`);

  const caches = buildCaches(sql);

  // ── Determine date windows ─────────────────────────────────────────────────
  let issuesSince, timeEntriesFrom;

  if (mode === 'full') {
    const d = new Date(Date.now() - FULL_SYNC_DAYS * 86400000);
    issuesSince      = d.toISOString().split('T')[0];
    timeEntriesFrom  = d.toISOString().split('T')[0];
  } else {
    // delta: issues since last successful sync (fallback: 30 min ago)
    const lastIssueSync = await getLastSynced(sql, 'issues');
    issuesSince = lastIssueSync
      ? new Date(new Date(lastIssueSync).getTime() - 60000).toISOString() // 1 min overlap for safety
      : new Date(Date.now() - 30 * 60000).toISOString();

    // time entries: Redmine has no updated_on filter, re-fetch last N days
    const d = new Date(Date.now() - DELTA_TIME_ENTRY_DAYS * 86400000);
    timeEntriesFrom = d.toISOString().split('T')[0];

    log(`  Issues since:       ${issuesSince}`);
    log(`  Time entries from:  ${timeEntriesFrom}`);
  }

  const results = {};

  // ── Users + Projects: full sync only ──────────────────────────────────────
  if (mode === 'full') {
    results.users = await syncUsers(sql, { userCache: caches.userCache, log });
    await writeSyncLog(sql, 'users', results.users);

    results.projects = await syncProjects(sql, { projectCache: caches.projectCache, log });
    await writeSyncLog(sql, 'projects', results.projects);
  } else {
    // For delta: pre-warm caches from DB so issue upserts resolve FKs
    log('📦 Pre-warming caches...');
    const allUsers    = await sql`SELECT id, redmine_id FROM users WHERE redmine_id IS NOT NULL`;
    const allProjects = await sql`SELECT id, redmine_id FROM projects WHERE redmine_id IS NOT NULL`;
    allUsers.forEach(u    => caches.userCache.set(u.redmine_id, u.id));
    allProjects.forEach(p => caches.projectCache.set(p.redmine_id, p.id));
    log(`  Loaded ${allUsers.length} users, ${allProjects.length} projects from cache`);
  }

  // ── Issues ────────────────────────────────────────────────────────────────
  try {
    results.issues = await syncIssues(sql, caches, issuesSince, log);
    await writeSyncLog(sql, 'issues', results.issues);
  } catch (e) {
    await writeSyncLog(sql, 'issues', { added: 0, updated: 0 }, 'error', e.message);
    throw e;
  }

  // ── Time Entries ──────────────────────────────────────────────────────────
  try {
    results.time_entries = await syncTimeEntries(sql, caches, timeEntriesFrom, log);
    await writeSyncLog(sql, 'time_entries', results.time_entries);
  } catch (e) {
    await writeSyncLog(sql, 'time_entries', { added: 0, updated: 0 }, 'error', e.message);
    throw e;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`\n✅ ${mode.toUpperCase()} sync complete in ${elapsed}s`);

  return {
    mode,
    elapsed: `${elapsed}s`,
    results,
  };
}
