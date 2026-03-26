/**
 * POST /api/sync — Runs Redmine sync inline (works on Vercel serverless)
 * Called by Vercel Cron daily + dashboard "Refresh Data" button
 */
const { getDb } = require('../../lib/db');

const REDMINE_URL = (process.env.REDMINE_URL || '').replace(/\/$/, '');
const REDMINE_KEY = process.env.REDMINE_API_KEY;

async function redmineFetch(path) {
  if (!REDMINE_URL || !REDMINE_KEY) throw new Error('Redmine not configured');
  const url = `${REDMINE_URL}${path}${path.includes('?') ? '&' : '?'}key=${REDMINE_KEY}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Redmine ${res.status}: ${res.statusText}`);
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
  }
  return results;
}

const userCache = new Map();
const projectCache = new Map();

async function getNeonUserId(sql, u) {
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

export default async function handler(req, res) {
  // Accept both POST (dashboard button) and GET (Vercel Cron)
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();
    const log = [];
    const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. Sync users
    log.push('Syncing users...');
    try {
      const users = await fetchAll('/users', 'users', '&status=0');
      for (const u of users) {
        const initials = u.firstname && u.lastname ? `${u.firstname[0]}${u.lastname[0]}`.toUpperCase() : 'XX';
        const name = `${u.firstname || ''} ${u.lastname || ''}`.trim();
        const r = await sql`
          INSERT INTO users (redmine_id, name, email, initials, active)
          VALUES (${u.id}, ${name}, ${u.mail || null}, ${initials}, true)
          ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()
          RETURNING id
        `;
        userCache.set(u.id, r[0].id);
      }
      log.push(`  Users: ${users.length} synced`);
    } catch (e) {
      log.push(`  Users: restricted (${e.message})`);
    }

    // 2. Sync projects
    log.push('Syncing projects...');
    const projects = await fetchAll('/projects', 'projects');
    for (const p of projects) {
      const r = await sql`
        INSERT INTO projects (redmine_id, name, description, status)
        VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
        ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
        RETURNING id
      `;
      projectCache.set(p.id, r[0].id);
    }
    log.push(`  Projects: ${projects.length} synced`);

    // 3. Sync issues (last 7 days)
    log.push(`Syncing issues since ${sinceDate}...`);
    const issues = await fetchAll('/issues', 'issues', `&status_id=*&updated_on=>=${sinceDate}&sort=updated_on:desc`);
    const statusMap = { 'New': 'Todo', 'In Progress': 'In Progress', 'Code Review': 'Review', 'Blocked': 'Blocked', 'Resolved': 'Closed', 'Closed': 'Closed', 'Feedback': 'Review' };
    const priorityMap = { 'Low': 'Low', 'Normal': 'Medium', 'High': 'High', 'Urgent': 'Critical', 'Immediate': 'Critical' };

    for (const issue of issues) {
      const assigneeId = await getNeonUserId(sql, issue.assigned_to);
      const authorId = await getNeonUserId(sql, issue.author);
      const projectId = projectCache.get(issue.project?.id);
      const status = statusMap[issue.status?.name] || issue.status?.name || 'Todo';
      const priority = priorityMap[issue.priority?.name] || 'Medium';
      const bzField = issue.custom_fields?.find(cf => cf.id === 9);
      const bzId = bzField ? String(bzField.value) : null;

      await sql`
        INSERT INTO issues (redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, bz_id, start_date, due_date, done_ratio, closed_at, created_at, updated_at)
        VALUES (${issue.id}, ${projectId || null}, ${issue.subject}, ${issue.description || null}, ${status}, ${priority}, ${assigneeId}, ${authorId}, ${bzId}, ${issue.start_date || null}, ${issue.due_date || null}, ${issue.done_ratio || 0}, ${issue.closed_on || null}, ${issue.created_on}, ${issue.updated_on})
        ON CONFLICT (redmine_id) DO UPDATE SET status=EXCLUDED.status, priority=EXCLUDED.priority, assigned_to_id=EXCLUDED.assigned_to_id, bz_id=EXCLUDED.bz_id, done_ratio=EXCLUDED.done_ratio, due_date=EXCLUDED.due_date, closed_at=EXCLUDED.closed_at, updated_at=EXCLUDED.updated_at
      `;
    }
    log.push(`  Issues: ${issues.length} synced`);

    // 4. Sync time entries (last 7 days)
    log.push(`Syncing time entries since ${sinceDate}...`);
    const entries = await fetchAll('/time_entries', 'time_entries', `&spent_on=>=${sinceDate}`);
    for (const e of entries) {
      const userId = await getNeonUserId(sql, e.user);
      const projectId = projectCache.get(e.project?.id);
      const resIssue = e.issue ? await sql`SELECT id FROM issues WHERE redmine_id = ${e.issue.id} LIMIT 1` : [];

      await sql`
        INSERT INTO time_entries (redmine_id, issue_id, user_id, project_id, hours, activity, comments, spent_on, created_at)
        VALUES (${e.id}, ${resIssue[0]?.id || null}, ${userId}, ${projectId || null}, ${e.hours}, ${e.activity?.name || null}, ${e.comments || null}, ${e.spent_on}, ${e.created_on})
        ON CONFLICT (redmine_id) DO UPDATE SET hours=EXCLUDED.hours, comments=EXCLUDED.comments
      `;
    }
    log.push(`  Time entries: ${entries.length} synced`);

    log.push('Sync complete!');
    res.status(200).json({ ok: true, log });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: err.message });
  }
}
