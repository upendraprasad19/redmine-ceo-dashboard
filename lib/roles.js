const ROLES = {
  manager: {
    label: 'Manager',
    canSeeAllTeams: true,
    canSeeAllProjects: true,
    canManageUsers: true,
    canAccessAdmin: true,
  },
  team_lead: {
    label: 'Team Lead',
    canSeeAllTeams: false,
    canSeeAllProjects: false,
    canManageUsers: false,
    canAccessAdmin: false,
  },
  developer: {
    label: 'Developer',
    canSeeAllTeams: false,
    canSeeAllProjects: false,
    canManageUsers: false,
    canAccessAdmin: false,
  },
};

function checkAccess(user, resource) {
  // user = { id, role, team }
  // resource = 'admin' | 'all_teams' | 'all_projects'
  if (!user) return false;
  const perms = ROLES[user.role];
  if (!perms) return false;
  switch (resource) {
    case 'admin':
      return perms.canAccessAdmin;
    case 'all_teams':
      return perms.canSeeAllTeams;
    case 'all_projects':
      return perms.canSeeAllProjects;
    default:
      return false;
  }
}

function scopeData(user, data, teamField = 'team') {
  // If manager, return all data. If team_lead, filter to user's team.
  if (!user) return [];
  if (ROLES[user.role]?.canSeeAllTeams) return data;
  return data.filter((item) => item[teamField] === user.team);
}

function canSeeUser(viewer, targetUser) {
  if (ROLES[viewer.role]?.canSeeAllTeams) return true;
  return targetUser.team === viewer.team;
}

function canSeeProject(viewer, project) {
  // Managers see all. Team leads see projects their team works on.
  if (ROLES[viewer.role]?.canSeeAllProjects) return true;
  // For team leads, this would need project-team mapping
  return true; // default allow, tighten later with project-team data
}

module.exports = { ROLES, checkAccess, scopeData, canSeeUser, canSeeProject };
