#!/usr/bin/env node
/**
 * scripts/blast-radius.js
 * Classifies the pushed range into blast-radius tiers by examining changed files.
 * Outputs: feature | account
 * feature: docs, .opencode, markdown, templates, .gitignore
 * account: any code change (pages/api, lib, scripts, crons, bots, components, .husky, etc.)
 * Fails safe to account on any error.
 */
const { execSync } = require('child_process')

const FEATURE_PATTERNS = [
  /^docs\//,
  /^\.opencode\//,
  /^templates\//,
  /\.md$/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
]

const ACCOUNT_PATTERNS = [
  /^pages\/api\//,
  /^lib\//,
  /^scripts\//,
  /^crons\//,
  /^bots\//,
  /^components\//,
  /^\.husky\//,
  /^migrations\//,
  /^schema\//,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^vitest\.config\.(js|mts)$/,
]

function classify(file) {
  for (const p of FEATURE_PATTERNS) {
    if (p.test(file)) return 'feature'
  }
  for (const p of ACCOUNT_PATTERNS) {
    if (p.test(file)) return 'account'
  }
  // Unclassified paths default to account (fail-safe)
  return 'account'
}

function run() {
  let files
  try {
    const output = execSync('git diff origin/main..HEAD --name-only', { encoding: 'utf8' })
    files = output
      .trim()
      .split('\n')
      .filter((f) => f.length > 0)
  } catch {
    // origin/main doesn't exist or git diff fails — fail-safe
    console.log('account')
    process.exit(0)
  }

  if (files.length === 0) {
    console.log('account')
    process.exit(0)
  }

  let tier = 'feature'
  for (const file of files) {
    const t = classify(file)
    if (t === 'account') {
      tier = 'account'
      break
    }
  }

  console.log(tier)
}

run()
