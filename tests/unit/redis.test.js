import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.UPSTASH_REDIS_REST_URL = 'https://test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'token'

const mockRedisMethods = {
  lrange: vi.fn().mockResolvedValue([]),
  lpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue('OK'),
  expire: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
}

// SAFETY: Replace @upstash/redis in require cache before loading our module.
// Requires pool: 'forks' in vitest.config.js — do NOT change to 'threads'.
const upstashPath = require.resolve('@upstash/redis')
require.cache[upstashPath] = {
  id: upstashPath,
  filename: upstashPath,
  loaded: true,
  exports: { Redis: vi.fn(() => mockRedisMethods) },
}

const redisModule = require('../../lib/redis.js')

beforeEach(() => {
  mockRedisMethods.lrange.mockResolvedValue([])
  mockRedisMethods.lpush.mockResolvedValue(1)
  mockRedisMethods.ltrim.mockResolvedValue('OK')
  mockRedisMethods.expire.mockResolvedValue(1)
  mockRedisMethods.del.mockResolvedValue(1)
})

afterEach(() => vi.clearAllMocks())

describe('getRecentMessages', () => {
  it('calls lrange with correct key and range', async () => {
    await redisModule.getRecentMessages(42, 10)
    expect(mockRedisMethods.lrange).toHaveBeenCalledWith('chat:42', 0, 9)
  })

  it('parses JSON strings and reverses to oldest-first', async () => {
    mockRedisMethods.lrange.mockResolvedValue([
      JSON.stringify({ role: 'user', content: 'second', ts: 2 }),
      JSON.stringify({ role: 'user', content: 'first', ts: 1 }),
    ])

    const result = await redisModule.getRecentMessages(1)

    expect(result).toEqual([
      { role: 'user', content: 'first', ts: 1 },
      { role: 'user', content: 'second', ts: 2 },
    ])
  })

  it('returns empty array when no messages', async () => {
    mockRedisMethods.lrange.mockResolvedValue([])
    const result = await redisModule.getRecentMessages(99)
    expect(result).toEqual([])
  })
})

describe('saveMessage', () => {
  it('calls lpush with JSON string containing role, content, ts', async () => {
    await redisModule.saveMessage(1, 'user', 'hello')

    expect(mockRedisMethods.lpush).toHaveBeenCalledTimes(1)
    const [key, msg] = mockRedisMethods.lpush.mock.calls[0]
    expect(key).toBe('chat:1')
    const parsed = JSON.parse(msg)
    expect(parsed).toMatchObject({ role: 'user', content: 'hello' })
    expect(typeof parsed.ts).toBe('number')
  })

  it('calls ltrim to keep last 20', async () => {
    await redisModule.saveMessage(1, 'user', 'x')
    expect(mockRedisMethods.ltrim).toHaveBeenCalledWith('chat:1', 0, 19)
  })

  it('calls expire with 24h TTL', async () => {
    await redisModule.saveMessage(1, 'user', 'x')
    expect(mockRedisMethods.expire).toHaveBeenCalledWith('chat:1', 86400)
  })
})

describe('clearSession', () => {
  it('calls del with correct key', async () => {
    await redisModule.clearSession(42)
    expect(mockRedisMethods.del).toHaveBeenCalledWith('chat:42')
  })
})
