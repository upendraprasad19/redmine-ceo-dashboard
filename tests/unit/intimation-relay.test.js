import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the real module first to spy on db
const dbModule = require('../../lib/db.js');

// Create mock sql function
const mockSql = vi.fn();

// Spy on the getDb function to return our mock
vi.spyOn(dbModule, 'getDb').mockImplementation(() => mockSql);

// Import the module under test
import { createThread, logEvent, transitionStatus, getOpenThreadForTarget } from '../../lib/intimation-relay.js';

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
