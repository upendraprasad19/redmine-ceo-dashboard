#!/usr/bin/env node
/**
 * check-secrets-not-committed.js
 * Gate: .env.local and other secret files must not be in git.
 * Violations: Secret files tracked by git.
 */
const { execSync } = require('child_process')

const SECRET_FILES = ['.env.local', '.env.production', '.env.development.local']

function main() {
  const violations = []

  for (const file of SECRET_FILES) {
    try {
      const result = execSync(`git ls-files --error-unmatch "${file}"`, {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (result.trim()) {
        violations.push(file)
      }
    } catch {
      // File not tracked — that's good
    }
  }

  // Also check for .env files in git
  try {
    const envFiles = execSync('git ls-files "*.env*" ".env*"', {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const tracked = envFiles
      .trim()
      .split('\n')
      .filter((f) => f)
    for (const f of tracked) {
      if (!violations.includes(f) && f !== '.env.example' && f !== '.env') {
        violations.push(f)
      }
    }
  } catch {
    // No env files tracked
  }

  if (violations.length > 0) {
    console.error('SECRETS NOT COMMITTED — Secret files tracked in git:')
    for (const v of violations) console.error(`  - ${v}`)
    console.error('\nRun: git rm --cached <file>')
    process.exit(1)
  }

  console.log('SECRETS NOT COMMITTED — No secret files tracked in git')
}

main()
