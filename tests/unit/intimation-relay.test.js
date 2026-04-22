import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the real module first to spy on db
const dbModule = require('../../lib/db.js');

// Create mock sql function
const mockSql = vi.fn();

// Spy on the getDb function to return our mock
vi.spyOn(dbModule, 'getDb').mockImplementation(() => mockSql);

// Import the module under test
import { createThread, logEvent, transitionStatus, getOpenThreadForTarget, canIntimate } from '../../lib/intimation-relay.js';

describe('createThread', () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it('inserts a bot_threads row and a sent event, returns thread id', async () => {
    // First call: INSERT into bot_threads RETURNING id
    // Second call: INSERT into bot_thread_events
    mockSql
      .mockResolvedValueOnce([{ id: 42 }])
      .mockResolvedValueOnce([]);

    const id = await createThread({
      originator_id: 1,
      target_id: 2,
      cc_user_id: null,
      issue_id: 100,
    });

    expect(id).toBe(42);
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

describe('logEvent', () => {
  beforeEach(() => { mockSql.mockReset(); });

  it('inserts a bot_thread_events row and updates last_event_at', async () => {
    mockSql.mockResolvedValueOnce([]);  // insert event
    mockSql.mockResolvedValueOnce([]);  // update last_event_at

    await logEvent({
      thread_id: 42,
      actor_id: 7,
      event_type: 'button_reply',
      payload: { button: 'working_on_it' },
    });

    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

describe('transitionStatus', () => {
  beforeEach(() => { mockSql.mockReset(); });

  it('updates bot_threads.status and returns the new status', async () => {
    mockSql.mockResolvedValueOnce([{ status: 'acked' }]);

    const next = await transitionStatus(42, 'acked');
    expect(next).toBe('acked');
  });

  it('throws on invalid status', async () => {
    await expect(transitionStatus(42, 'bogus')).rejects.toThrow(/invalid status/i);
  });
});

describe('getOpenThreadForTarget', () => {
  beforeEach(() => { mockSql.mockReset(); });

  it('returns the most recently active open thread for a target user', async () => {
    mockSql.mockResolvedValueOnce([{ id: 99, status: 'sent', last_event_at: new Date() }]);

    const t = await getOpenThreadForTarget(5);
    expect(t.id).toBe(99);
  });

  it('returns null when no open thread exists', async () => {
    mockSql.mockResolvedValueOnce([]);
    const t = await getOpenThreadForTarget(5);
    expect(t).toBeNull();
  });
});

describe('canIntimate', () => {
  it('manager can intimate a developer on any team', () => {
    const from = { role: 'manager', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Beta' };
    expect(canIntimate(from, to).allowed).toBe(true);
  });

  it('TL can intimate a developer on their own team', () => {
    const from = { role: 'team_lead', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Alpha' };
    expect(canIntimate(from, to).allowed).toBe(true);
  });

  it('TL cannot intimate a developer on a different team', () => {
    const from = { role: 'team_lead', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Beta' };
    const r = canIntimate(from, to);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/own team/i);
  });

  it('TL cannot intimate another TL (Phase 2)', () => {
    const from = { role: 'team_lead', team: 'Alpha' };
    const to   = { role: 'team_lead', team: 'Alpha' };
    expect(canIntimate(from, to).allowed).toBe(false);
  });

  it('developer cannot initiate intimation', () => {
    const from = { role: 'developer', team: 'Alpha' };
    const to   = { role: 'developer', team: 'Alpha' };
    expect(canIntimate(from, to).allowed).toBe(false);
  });
});
