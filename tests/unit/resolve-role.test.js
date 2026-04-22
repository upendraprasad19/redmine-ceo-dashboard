import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { resolveRole } = require('../../lib/roles.js');

describe('resolveRole', () => {
  let originalManagerUsernames;

  beforeEach(() => {
    originalManagerUsernames = process.env.MANAGER_USERNAMES;
  });

  afterEach(() => {
    if (originalManagerUsernames === undefined) {
      delete process.env.MANAGER_USERNAMES;
    } else {
      process.env.MANAGER_USERNAMES = originalManagerUsernames;
    }
  });

  it('returns "manager" when username is in MANAGER_USERNAMES (case-insensitive)', () => {
    process.env.MANAGER_USERNAMES = 'anu,upendra,prashant,pradeep';
    expect(resolveRole({ is_team_lead: true }, 'upendra')).toBe('manager');
    expect(resolveRole({ is_team_lead: false }, 'UPENDRA')).toBe('manager');
    expect(resolveRole(null, 'Anu')).toBe('manager');
  });

  it('trims whitespace around usernames in MANAGER_USERNAMES', () => {
    process.env.MANAGER_USERNAMES = '  anu , upendra ,  pradeep  ';
    expect(resolveRole(null, 'upendra')).toBe('manager');
    expect(resolveRole(null, 'pradeep')).toBe('manager');
  });

  it('returns "team_lead" when username not in manager list and is_team_lead is true', () => {
    process.env.MANAGER_USERNAMES = 'anu,upendra';
    expect(resolveRole({ is_team_lead: true }, 'vivek')).toBe('team_lead');
  });

  it('returns "developer" when username not in manager list and is_team_lead is falsy/absent', () => {
    process.env.MANAGER_USERNAMES = 'anu,upendra';
    expect(resolveRole({ is_team_lead: false }, 'vivek')).toBe('developer');
    expect(resolveRole({}, 'vivek')).toBe('developer');
    expect(resolveRole({ is_team_lead: null }, 'vivek')).toBe('developer');
  });

  it('does not throw when MANAGER_USERNAMES is unset; falls through to team-lead/developer', () => {
    delete process.env.MANAGER_USERNAMES;
    expect(() => resolveRole({ is_team_lead: true }, 'upendra')).not.toThrow();
    expect(resolveRole({ is_team_lead: true }, 'upendra')).toBe('team_lead');
    expect(resolveRole({ is_team_lead: false }, 'upendra')).toBe('developer');
  });

  it('does not throw when MANAGER_USERNAMES is empty string', () => {
    process.env.MANAGER_USERNAMES = '';
    expect(resolveRole({ is_team_lead: false }, 'upendra')).toBe('developer');
  });

  it('does not throw and returns "developer" when redmineUser is null and username not in list', () => {
    process.env.MANAGER_USERNAMES = 'anu,upendra';
    expect(() => resolveRole(null, 'vivek')).not.toThrow();
    expect(resolveRole(null, 'vivek')).toBe('developer');
    expect(resolveRole(undefined, 'vivek')).toBe('developer');
  });
});
