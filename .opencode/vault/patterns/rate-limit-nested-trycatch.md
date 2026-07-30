---
created: 2026-07-30
tags: [patterns, rate-limiting, security]
related: [[rate-limiting-sliding-window], [fail-open-rate-limit], [unhandled-async-before-trycatch]]
---

# rate-limit-nested-trycatch

## Summary
Rate limiting with `checkRateLimit` MUST be inside its own nested try/catch within the existing outer try block. If placed at the top of the outer try without a nested try/catch, a Redis outage will crash the handler with HTML 500 instead of failing open.

## Pattern
```javascript
// Inside existing try block, with OWN nested try/catch:
try {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  const { allowed, retryAfter } = await checkRateLimit(`ratelimit:fp-req:${ip}`, {
    windowSec: 60,
    max: 5,
  })
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfter))
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }
} catch (rlErr) {
  console.warn('Rate-limit check failed (Redis down?):', rlErr.message)
}
```

## Why
- `checkRateLimit` calls Redis which can fail
- If Redis failure propagates to outer try/catch, it returns HTML 500
- Vault gotcha `unhandled-async-before-trycatch` warns about this pattern
- Fail-open requires catching Redis errors and proceeding

## Verification
- All rate limit checks have their own nested try/catch
- Console.warn logs Redis failures for debugging
- Handler continues if Redis is down

## Related
- [[rate-limiting-sliding-window]]
- [[fail-open-rate-limit]]
- [[unhandled-async-before-trycatch]]
