# CJS Mocking Gotcha in Vitest

**Last updated:** 2026-07-30 (AUD-029 — tests now work)

## Problem
`vi.mock()` does **not** intercept CJS `require()` calls in vitest 1.6.1. This means:
- `vi.mock('../../lib/auth.js', () => ({ fn: vi.fn() }))` is silently ignored
- `vi.mock('@upstash/redis', ...)` does not prevent the real package from loading
- Tests relying on `vi.mock` get `DATABASE_URL not set`, `url property missing`, or real API calls

Additionally, `vi.spyOn` on npm packages with non-configurable exports (e.g., `@neondatabase/serverless`, `@upstash/redis`) throws `Cannot redefine property`.

## Solution

### Pattern 1: require-first-then-spy (internal modules)
```js
const dbModule = require('../../lib/db.js')
vi.spyOn(dbModule, 'getDb').mockReturnValue(vi.fn())
const authModule = require('../../lib/auth.js') // gets spied version
```

### Pattern 2: require.cache replacement (npm packages)
```js
const upstashPath = require.resolve('@upstash/redis')
require.cache[upstashPath] = { id: upstashPath, loaded: true, exports: { Redis: vi.fn(() => mock) } }
const redisModule = require('../../lib/redis.js')
```
**Requires `pool: 'forks'`** — threads leak cache mutations.

### Pattern 3: vi.spyOn on Node built-ins (inside test functions)
```js
it('test', () => {
  const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue('content')
  // ... test ...
  spy.mockRestore()
})
```

## Key Rules
1. Never use `vi.mock()` — it does not work for CJS
2. Use `vi.clearAllMocks()` not `vi.restoreAllMocks()` — preserves spy bindings
3. Spy order: leaf module → spy → dependent module
4. `pool: 'forks'` required for require.cache manipulation
