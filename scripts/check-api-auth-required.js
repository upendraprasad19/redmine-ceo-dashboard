#!/usr/bin/env node
/**
 * check-api-auth-required.js
 * Gate: Every API route must have auth check (session cookie or CRON_SECRET).
 * Violations: Routes that can be called without authentication.
 */
const fs = require('fs')
const path = require('path')

const API_DIR = path.join(__dirname, '..', 'pages', 'api')
const EXEMPT_PATHS = ['auth/login.js', 'auth/forgot-password', 'cron/run.js']

function findApiFiles() {
  const files = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) files.push(full)
    }
  }
  walk(API_DIR)
  return files
}

function isExempt(filePath) {
  const rel = path.relative(API_DIR, filePath)
  return EXEMPT_PATHS.some((p) => rel.startsWith(p))
}

function hasAuthCheck(content) {
  const authPatterns = [
    /getCurrentUser/,
    /req\.cookies\.ceo_session/,
    /CRON_SECRET/,
    /req\.headers\[.x-cron-secret.\]/,
    /req\.headers\[['"]x-cron-secret['"]\]/,
  ]
  return authPatterns.some((p) => p.test(content))
}

function main() {
  const files = findApiFiles()
  const violations = []

  for (const file of files) {
    if (isExempt(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    if (!hasAuthCheck(content)) {
      violations.push(path.relative(path.join(__dirname, '..'), file))
    }
  }

  if (violations.length > 0) {
    console.error('API AUTH REQUIRED — Routes without auth check:')
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }

  console.log('API AUTH REQUIRED — All routes have auth check')
}

main()
