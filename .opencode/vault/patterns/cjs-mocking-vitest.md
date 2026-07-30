# CJS Module Mocking in vitest 1.6.1

**Date:** 2026-07-30
**Source:** AUD-029 (unit test implementation)

## Problem

`vi.mock()` does **not** intercept CJS `require()` calls in vitest 1.6.1. This means:
- `vi.mock('../../lib/auth.js', () => ({ fn: vi.fn() }))` is silently ignored
- `vi.mock('@upstash/redis', ...)` does not prevent the real package from loading
- Tests that rely on `vi.mock` for CJS modules get `DATABASE_URL not set` or real API calls

Additionally, `vi.spyOn(module, 'prop')` on non-configurable npm package exports (e.g., `@neondatabase/serverless`, `@upstash/redis`) throws `Cannot redefine property`.

## Solution Patterns

### Pattern 1: require-first-then-spy (for internal modules)

Mock before the dependent module loads. The dependent module's `const { fn } = require('./a')` destructures from the cached exports where the spy is already in place.

```js
// 1. Load leaf module first
const dbModule = require('../../lib/db.js')

// 2. Spy on its exports (must be BEFORE dependent module loads)
vi.spyOn(dbModule, 'getDb').mockReturnValue(vi.fn())

// 3. Load dependent module — it gets the spied version
const authModule = require('../../lib/auth.js')
```

**Works for:** `lib/db.js`, `lib/auth.js`, `lib/roles.js`, `lib/ai.js`, `lib/redis.js`

### Pattern 2: require.cache replacement (for npm packages with non-configurable exports)

When `vi.spyOn` throws `Cannot redefine property`, replace the module in Node's require cache before loading the dependent module.

```js
const upstashPath = require.resolve('@upstash/redis')
require.cache[upstashPath] = {
  id: upstashPath,
  filename: upstashPath,
  loaded: true,
  exports: { Redis: vi.fn(() => mockRedisMethods) },
}

const redisModule = require('../../lib/redis.js')
```

**CRITICAL:** Requires `pool: 'forks'` in vitest.config.js. With `pool: 'threads'`, cache mutations leak across test files.

### Pattern 3: vi.spyOn on Node built-ins (inside test functions only)

For `fs`, `path`, etc., use `vi.spyOn` inside test functions with `spy.mockRestore()` cleanup.

```js
it('test case', () => {
  const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue('content')
  // ... test ...
  spy.mockRestore()
})
```

Do NOT put `vi.spyOn(fs, ...)` at the top level — it breaks `require()` of modules that use `fs`.

## Key Rules

1. **Never use `vi.mock()`** in this codebase — it does not work for CJS
2. **`vi.clearAllMocks()`** over `vi.restoreAllMocks()` — preserves spy bindings held by CJS modules
3. **`pool: 'forks'`** is required for `require.cache` manipulation
4. **Spy order matters**: leaf module → spy → dependent module

## See Also

- `tests/unit/admin.test.js` — Pattern 1 example
- `tests/unit/redis.test.js` — Pattern 2 example
- `tests/unit/table-audit.test.js` — Pattern 3 example
