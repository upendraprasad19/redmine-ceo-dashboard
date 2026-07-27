const { getRedis } = require('./redis')

const DEFAULT_WINDOW = 60
const DEFAULT_MAX = 10

async function checkRateLimit(key, { windowSec = DEFAULT_WINDOW, max = DEFAULT_MAX } = {}) {
  const r = getRedis()
  const now = Date.now()
  const windowStart = now - windowSec * 1000

  const multi = r.multi()
  multi.zremrangebyscore(key, 0, windowStart)
  multi.zadd(key, { score: now, member: `${now}:${Math.random().toString(36).slice(2, 8)}` })
  multi.zcard(key)
  multi.expire(key, windowSec)

  const results = await multi.exec()
  const count = Number(results[2])

  if (count > max) {
    return { allowed: false, remaining: 0, retryAfter: windowSec }
  }

  return { allowed: true, remaining: max - count, retryAfter: 0 }
}

module.exports = { checkRateLimit }
