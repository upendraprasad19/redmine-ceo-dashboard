/**
 * lib/constants.js
 * Shared constants used across sync scripts, API routes, and cron jobs.
 * Single source of truth — update here, not in individual files.
 */

const STATUS_MAP = {
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

const PRIORITY_MAP = {
  Low: 'Low',
  Normal: 'Medium',
  High: 'High',
  Urgent: 'Critical',
  Immediate: 'Critical',
}

const EXPECTED_TIME_TEAMS = ['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']

const APPROVED_PROJECT_IDS = new Set([
  2, 3, 5, 7, 14, 15, 16, 17, 18, 19, 20, 21, 23, 29, 34, 43, 44, 47, 49, 50, 51, 55, 56, 57, 60,
  61, 62, 63, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
])

module.exports = { STATUS_MAP, PRIORITY_MAP, EXPECTED_TIME_TEAMS, APPROVED_PROJECT_IDS }
