// vitest.config.js
module.exports = {
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
    pool: 'threads',
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
