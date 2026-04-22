import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on ai.chat to intercept AI calls
const aiModule = require('../../lib/ai.js');
const mockChat = vi.fn();
vi.spyOn(aiModule, 'chat').mockImplementation((...args) => mockChat(...args));

import { extractCommitment } from '../../lib/commitments.js';

describe('extractCommitment', () => {
  beforeEach(() => { mockChat.mockReset(); });

  it('returns null when the text has no time commitment', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ has_commitment: false }) } }],
    });
    const r = await extractCommitment({ text: "I'll look into it", now: new Date('2026-04-22T09:00:00Z') });
    expect(r).toBeNull();
  });

  it('extracts a due datetime and promise text when present', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        has_commitment: true,
        due_at: '2026-04-22T18:00:00+05:30',
        promise_text: 'will close by EOD',
      }) } }],
    });
    const r = await extractCommitment({
      text: 'will close by EOD today',
      now: new Date('2026-04-22T09:00:00Z'),
    });
    expect(r.promise_text).toBe('will close by EOD');
    expect(r.due_at).toBeInstanceOf(Date);
  });

  it('returns null when due_at is in the past', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        has_commitment: true,
        due_at: '2026-04-20T10:00:00+05:30',
        promise_text: 'yesterday',
      }) } }],
    });
    const r = await extractCommitment({
      text: 'I said I would do it yesterday',
      now: new Date('2026-04-22T09:00:00Z'),
    });
    expect(r).toBeNull();
  });

  it('returns null when AI response is not valid JSON', async () => {
    mockChat.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json at all' } }],
    });
    const r = await extractCommitment({ text: 'whatever', now: new Date() });
    expect(r).toBeNull();
  });
});
