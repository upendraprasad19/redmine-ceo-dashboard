import { describe, expect, it } from 'vitest'

const { ROLES, checkAccess, scopeData, canSeeUser, canSeeProject } = require('../../lib/roles.js')

const manager = { id: 1, role: 'manager', team: 'Alpha' }
const teamLead = { id: 2, role: 'team_lead', team: 'Alpha' }
const developer = { id: 3, role: 'developer', team: 'Beta' }

describe('ROLES', () => {
  it('has manager, team_lead, and developer keys', () => {
    expect(ROLES).toHaveProperty('manager')
    expect(ROLES).toHaveProperty('team_lead')
    expect(ROLES).toHaveProperty('developer')
  })

  it('manager has all permissions', () => {
    expect(ROLES.manager.canAccessAdmin).toBe(true)
    expect(ROLES.manager.canSeeAllTeams).toBe(true)
    expect(ROLES.manager.canSeeAllProjects).toBe(true)
  })

  it('team_lead has limited permissions', () => {
    expect(ROLES.team_lead.canAccessAdmin).toBe(false)
    expect(ROLES.team_lead.canSeeAllTeams).toBe(false)
  })

  it('developer has minimal permissions', () => {
    expect(ROLES.developer.canAccessAdmin).toBe(false)
    expect(ROLES.developer.canSeeAllTeams).toBe(false)
  })
})

describe('checkAccess', () => {
  it('allows manager to admin', () => {
    expect(checkAccess(manager, 'admin')).toBe(true)
  })

  it('denies team_lead admin access', () => {
    expect(checkAccess(teamLead, 'admin')).toBe(false)
  })

  it('denies developer admin access', () => {
    expect(checkAccess(developer, 'admin')).toBe(false)
  })

  it('allows manager all_teams access', () => {
    expect(checkAccess(manager, 'all_teams')).toBe(true)
  })

  it('denies team_lead all_teams access', () => {
    expect(checkAccess(teamLead, 'all_teams')).toBe(false)
  })

  it('returns false for null user', () => {
    expect(checkAccess(null, 'admin')).toBe(false)
  })

  it('returns false for unknown role', () => {
    expect(checkAccess({ role: 'bogus' }, 'admin')).toBe(false)
  })

  it('returns false for unknown resource', () => {
    expect(checkAccess(manager, 'unknown_resource')).toBe(false)
  })
})

describe('scopeData', () => {
  const data = [
    { name: 'Alice', team: 'Alpha' },
    { name: 'Bob', team: 'Alpha' },
    { name: 'Charlie', team: 'Beta' },
  ]

  it('returns all data for manager', () => {
    const result = scopeData(manager, data)
    expect(result).toHaveLength(3)
  })

  it('filters by team for team_lead', () => {
    const result = scopeData(teamLead, data)
    expect(result).toHaveLength(2)
    expect(result.every((d) => d.team === 'Alpha')).toBe(true)
  })

  it('returns empty array for null user', () => {
    expect(scopeData(null, data)).toEqual([])
  })

  it('supports custom team field', () => {
    const customData = [
      { name: 'Alice', dept: 'Alpha' },
      { name: 'Bob', dept: 'Beta' },
    ]
    const result = scopeData(teamLead, customData, 'dept')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Alice')
  })
})

describe('canSeeUser', () => {
  it('manager can see any user', () => {
    expect(canSeeUser(manager, developer)).toBe(true)
  })

  it('team_lead can see same team user', () => {
    const sameTeam = { role: 'developer', team: 'Alpha' }
    expect(canSeeUser(teamLead, sameTeam)).toBe(true)
  })

  it('team_lead cannot see different team user', () => {
    expect(canSeeUser(teamLead, developer)).toBe(false)
  })
})

describe('canSeeProject', () => {
  it('manager can see any project', () => {
    expect(canSeeProject(manager, {})).toBe(true)
  })

  it('non-manager defaults to true (tighten later)', () => {
    expect(canSeeProject(teamLead, {})).toBe(true)
  })
})