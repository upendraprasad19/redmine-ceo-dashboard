// scripts/sync-initial.js
// Manual initial sync: Upserts all data from Oct 1, 2025 onward (idempotent)
// Usage: node scripts/sync-initial.js

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const REDMINE_URL = process.env.REDMINE_URL.replace(/\/$/, '');
const REDMINE_KEY = process.env.REDMINE_API_KEY;
const START_DATE = '2025-10-01'; // Fixed start date

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

// ...user/project cache helpers (reuse from sync-redmine.js)...
const userCache = new Map();
const projectCache = new Map();
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

// --- SYNC USERS ---
async function syncUsers() {
  console.log('\n👤 Syncing users...');
  const users = await fetchAll('/users', 'users', '&status=0');
  for (const u of users) {
    const initials = u.firstname && u.lastname ? `${u.firstname[0]}${u.lastname[0]}`.toUpperCase() : 'XX';
    const name = `${u.firstname || ''} ${u.lastname || ''}`.trim();
    await sql`
      INSERT INTO users (redmine_id, name, email, initials, active)
      VALUES (${u.id}, ${name}, ${u.mail || null}, ${initials}, true)
      ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()
    `;
    userCache.set(u.id, u.id);
  }
}

// --- SYNC PROJECTS ---
async function syncProjects() {
  console.log('\n📁 Syncing projects...');
  const projects = await fetchAll('/projects', 'projects');
  for (const p of projects) {
    await sql`
      INSERT INTO projects (redmine_id, name, description, status)
      VALUES (${p.id}, ${p.name}, ${p.description || null}, ${p.status === 1 ? 'active' : 'archived'})
      ON CONFLICT (redmine_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()
    `;
    projectCache.set(p.id, p.id);
  }
}

// --- SYNC ISSUES ---
async function syncIssues() {
  console.log(`\n🎫 Syncing issues from ${START_DATE}...`);
  const issues = await fetchAll('/issues', 'issues', `&status_id=*&created_on=>=${START_DATE}&sort=created_on:asc`);
  for (const issue of issues) {
    const assigneeId = await getNeonUserId(issue.assigned_to);
    const authorId   = await getNeonUserId(issue.author);
    const projectId  = projectCache.get(issue.project?.id);
    await sql`
      INSERT INTO issues (redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, start_date, due_date, done_ratio, closed_at, created_at, updated_at)
      VALUES (${issue.id}, ${projectId || null}, ${issue.subject}, ${issue.description || null}, ${issue.status?.name || 'Todo'}, ${issue.priority?.name || 'Medium'}, ${assigneeId}, ${authorId}, ${issue.start_date || null}, ${issue.due_date || null}, ${issue.done_ratio || 0}, ${issue.closed_on || null}, ${issue.created_on}, ${issue.updated_on})
      ON CONFLICT (redmine_id) DO UPDATE SET status=EXCLUDED.status, priority=EXCLUDED.priority, assigned_to_id=EXCLUDED.assigned_to_id, done_ratio=EXCLUDED.done_ratio, due_date=EXCLUDED.due_date, closed_at=EXCLUDED.closed_at, updated_at=EXCLUDED.updated_at
    `;
  }
}

// --- SYNC TIME ENTRIES ---
async function syncTimeEntries() {
  console.log(`\n⏱️  Syncing time entries from ${START_DATE}...`);
  const entries = await fetchAll('/time_entries', 'time_entries', `&spent_on=>=${START_DATE}`);
  for (const e of entries) {
    const userId    = await getNeonUserId(e.user);
    const projectId = projectCache.get(e.project?.id);
    const resIssue  = e.issue ? await sql`SELECT id FROM issues WHERE redmine_id = ${e.issue.id} LIMIT 1` : [];
    await sql`
      INSERT INTO time_entries (redmine_id, issue_id, user_id, project_id, hours, activity, comments, spent_on, created_at)
      VALUES (${e.id}, ${resIssue[0]?.id || null}, ${userId}, ${projectId || null}, ${e.hours}, ${e.activity?.name || null}, ${e.comments || null}, ${e.spent_on}, ${e.created_on})
      ON CONFLICT (redmine_id) DO UPDATE SET hours=EXCLUDED.hours, comments=EXCLUDED.comments
    `;
  }
}

// --- MAIN ---
async function main() {
  try {
    await syncUsers();
    await syncProjects();
    await syncIssues();
    await syncTimeEntries();
    console.log('\n✅ Initial sync complete!');
  } catch (err) {
    console.error('\n❌ Initial sync failed:', err.message);
    process.exit(1);
  }
}

main();
