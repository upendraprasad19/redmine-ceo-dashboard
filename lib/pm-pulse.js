/**
 * lib/pm-pulse.js
 * Shared bucket routing logic — mirrors AppScript routeProjectBucket_ exactly.
 */

const MAYA_PROJECTS = [
  'Maya Virtual Assistant',
  'Claim Info Bot',
  'Maya Agents',
  'Maya Audits / Assistance',
  'Maya Charts',
  'Maya Docs',
  'Maya Insights',
  'Maya Predictions',
  'Maya Voice',
  'Producer App',
  'Support Bot'
];

// Bucket labels match AppScript sheet names exactly.
// Note: 'iCLAIMS' (without 2.0) and 'Reports' (without 3.0) are separate
// projects and correctly fall into 'Miscellaneous'.
function getProjectBucket(projectName) {
  if (projectName === 'iCLAIMS 2.0') return 'iCLAIMS 2.0';
  if (projectName === 'Reports 3.0') return 'Reports 3.0';
  if (MAYA_PROJECTS.includes(projectName)) return 'Maya Virtual Agent & Sub';
  return 'Miscellaneous';
}

const BUCKET_LABELS = ['iCLAIMS 2.0', 'Reports 3.0', 'Maya Virtual Agent & Sub', 'Miscellaneous'];

module.exports = { getProjectBucket, MAYA_PROJECTS, BUCKET_LABELS };
