// vitest.config.js
module.exports = {
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
    // SAFETY: 'forks' gives process-level isolation required for require.cache
    // manipulation in tests (e.g., redis.test.js, rate-limit.test.js). Do NOT
    // change to 'threads' — it leaks cache mutations across test files.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.js'],
      thresholds: {
        'lib/': 60,
      },
    },
  },
}
