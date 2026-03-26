const REDMINE_URL = (process.env.REDMINE_URL || '').replace(/\/$/, '');
const REDMINE_KEY = process.env.REDMINE_API_KEY;

// HARD GUARD: Only GET requests allowed. Never POST/PUT/DELETE to Redmine.
async function redmineFetch(path) {
  if (!REDMINE_URL || !REDMINE_KEY) {
    throw new Error('Redmine not configured');
  }
  const separator = path.includes('?') ? '&' : '?';
  const url = `${REDMINE_URL}${path}${separator}key=${REDMINE_KEY}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Redmine ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function getTickets(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status_id', params.status);
  if (params.assignee) query.set('assigned_to_id', params.assignee);
  if (params.project) query.set('project_id', params.project);
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);
  if (params.sort) query.set('sort', params.sort);
  const qs = query.toString();
  const path = `/issues.json${qs ? '?' + qs : ''}`;
  const data = await redmineFetch(path);
  return data.issues;
}

async function getTicket(id) {
  const data = await redmineFetch(`/issues/${id}.json?include=journals,attachments`);
  return data.issue;
}

async function getTicketsByAssignee(userId) {
  const data = await redmineFetch(
    `/issues.json?assigned_to_id=${userId}&status_id=open&limit=100`
  );
  return data.issues;
}

async function getOverdueTickets() {
  const today = new Date().toISOString().split('T')[0];
  const data = await redmineFetch(
    `/issues.json?status_id=open&due_date=%3C%3D${today}&sort=due_date:asc&limit=100`
  );
  return data.issues;
}

async function getProjects() {
  const data = await redmineFetch('/projects.json?limit=100');
  return data.projects;
}

async function getProject(id) {
  const data = await redmineFetch(`/projects/${id}.json?include=trackers,issue_categories`);
  return data.project;
}

async function getUsers() {
  const data = await redmineFetch('/users.json?status=0&limit=100');
  return data.users;
}

async function getUser(id) {
  const data = await redmineFetch(`/users/${id}.json?include=memberships`);
  return data.user;
}

async function getTimeEntries(params = {}) {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.user_id) query.set('user_id', params.user_id);
  if (params.project_id) query.set('project_id', params.project_id);
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);
  const qs = query.toString();
  const path = `/time_entries.json${qs ? '?' + qs : ''}`;
  const data = await redmineFetch(path);
  return data.time_entries;
}

async function getTimeEntriesByUser(userId, from, to) {
  const query = new URLSearchParams();
  query.set('user_id', userId);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  query.set('limit', '100');
  const data = await redmineFetch(`/time_entries.json?${query.toString()}`);
  return data.time_entries;
}

module.exports = {
  getTickets,
  getTicket,
  getTicketsByAssignee,
  getOverdueTickets,
  getProjects,
  getProject,
  getUsers,
  getUser,
  getTimeEntries,
  getTimeEntriesByUser,
};
