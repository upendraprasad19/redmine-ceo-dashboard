import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPipeline = {
  zremrangebyscore: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([null, null, 5, true]),
}

const redisModule = require('../../lib/redis.js')
vi.spyOn(redisModule, 'getRedis').mockReturnValue({ multi: () => mockPipeline })

const { checkRateLimit } = require('../../lib/rate-limit.js')

beforeEach(() => {
  mockPipeline.exec.mockResolvedValue([null, null, 5, true])
  mockPipeline.zremrangebyscore.mockClear()
  mockPipeline.zadd.mockClear()
  mockPipeline.zcard.mockClear()
  mockPipeline.expire.mockClear()
})

afterEach(() => vi.clearAllMocks())

describe('checkRateLimit', () => {
  it('returns allowed when under max', async () => {
    mockPipeline.exec.mockResolvedValue([null, null, 5, true])
    const result = await checkRateLimit('test:key', { windowSec: 60, max: 10 })
    expect(result).toMatchObject({ allowed: true, remaining: 5 })
  })

  it('returns not allowed when over max', async () => {
    mockPipeline.exec.mockResolvedValue([null, null, 11, true])
    const result = await checkRateLimit('test:key', { windowSec: 60, max: 10 })
    expect(result).toMatchObject({ allowed: false, remaining: 0, retryAfter: 60 })
  })

  it('uses default window=60 and max=10', async () => {
    mockPipeline.exec.mockResolvedValue([null, null, 5, true])
    const result = await checkRateLimit('test:key')
    expect(result).toMatchObject({ allowed: true, remaining: 5 })
  })

  it('respects custom windowSec and max', async () => {
    mockPipeline.exec.mockResolvedValue([null, null, 3, true])
    const result = await checkRateLimit('test:key', { windowSec: 30, max: 5 })
    expect(result).toMatchObject({ allowed: true, remaining: 2 })
  })

  it('calls zremrangebyscore to prune old entries', async () => {
    await checkRateLimit('test:key', { windowSec: 60, max: 10 })
    expect(mockPipeline.zremrangebyscore).toHaveBeenCalled()
  })
})
