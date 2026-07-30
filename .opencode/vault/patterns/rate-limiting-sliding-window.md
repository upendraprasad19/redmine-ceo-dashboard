# Rate Limiting — Sliding Window (Upstash Redis)

## Pattern
`lib/rate-limit.js` implements a sliding window rate limiter using Upstash Redis sorted sets.

```javascript
const { checkRateLimit } = require('../../lib/rate-limit')

// 10 requests per minute per IP
try {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  const { allowed, retryAfter } = await checkRateLimit(`ratelimit:login:${ip}`, {
    windowSec: 60,
    max: 10,
  })
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfter))
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }
} catch (rlErr) {
  console.warn('Rate-limit check failed (Redis down?):', rlErr.message)
}
```

## Key properties
- Uses Redis sorted sets (ZREMRANGEBYSCORE + ZCARD + ZADD)
- Sliding window — not fixed window, so burst protection is tighter
- Returns `{ allowed, remaining, retryAfter }` — remaining count lets client know
- If Redis unavailable, allows the request (fail-open)
- Key format: `{namespace}:{identifier}` — use descriptive prefixes
- **Critical:** Each rate limit check MUST be inside its own nested try/catch within the existing outer try block (per vault gotcha `unhandled-async-before-trycatch`)

## Currently applied
- `pages/api/auth/login.js` — 10 req/min per IP
- `pages/api/auth/forgot-password/request.js` — 5 req/min per IP
- `pages/api/auth/forgot-password/verify.js` — 5 req/min per IP
- `pages/api/chat.js` — 30 req/min per user
- `pages/api/sync.js` — 1 req/min per user

## When to add more
- Any endpoint accepting user-generated content (forms, chat, etc.)
- Endpoints that trigger expensive operations (sync, AI calls)
