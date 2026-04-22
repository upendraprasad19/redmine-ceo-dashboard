// vitest.config.js
module.exports = {
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
    pool: 'threads',
  },
};
