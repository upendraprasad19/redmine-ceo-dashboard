import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the real module first to spy on db
const dbModule = require('../../lib/db.js');

// Create mock sql function
const mockSql = vi.fn();

// Spy on the getDb function to return our mock
vi.spyOn(dbModule, 'getDb').mockImplementation(() => mockSql);

// Import the module under test
import { createThread } from '../../lib/intimation-relay.js';

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
