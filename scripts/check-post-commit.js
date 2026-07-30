#!/usr/bin/env node
/**
 * scripts/check-post-commit.js
 * Post-commit reminder: if vault/INDEX.md wasn't in the commit diff,
 * remind to run self-learning and update vault.
 */

const { execSync } = require('node:child_process')

try {
  const diffFiles = execSync('git diff --name-only HEAD~1..HEAD', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()

  if (!diffFiles.includes('.opencode/vault/')) {
    console.log('')
    console.log('📋 POST-COMMIT REMINDER:')
    console.log('   vault/INDEX.md was not updated in this commit.')
    console.log('   Run: skill self-learning')
    console.log('   Then update vault/patterns/ or vault/gotchas/ if new knowledge was discovered.')
    console.log('')
  }
} catch {
  // skip
}
