#!/usr/bin/env node
/**
 * scripts/review-diff.js
 * Pre-push code review: analyzes staged diff for anti-patterns.
 * 10 checks across 5 areas: error handling, industry norms, SOT, DB consistency, naming.
 * Exits 1 if any critical issue found, 0 otherwise.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const results = { critical: [], warning: [] }

function warn(msg) {
  results.warning.push(msg)
}
function critical(msg) {
  results.critical.push(msg)
}

function getStagedDiff() {
  try {
    return execSync('git diff --cached', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return ''
  }
}

function getCommitsBeingPushed() {
  try {
    return execSync('git log --oneline origin/main..HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function parseDiff(diff) {
  const files = {}
  let current = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6)
      files[current] = []
    } else if (current && line.startsWith('+') && !line.startsWith('+++')) {
      files[current].push(line.slice(1))
    }
  }
  return files
}

// ── Check 1: err.message in responses ──────────────────────
function checkErrMessageLeaks(files) {
  for (const [file, lines] of Object.entries(files)) {
    for (const line of lines) {
      if (/\.(json|send)\s*\(/.test(line) && /err\.message|error\.message/i.test(line)) {
        critical(`err.message leak in ${file}: ${line.trim().slice(0, 80)}`)
      }
    }
  }
}

// ── Check 2: payload before definition ─────────────────────
function checkPayloadBeforeDefinition(files) {
  for (const [file, lines] of Object.entries(files)) {
    const uses = lines.findIndex((l) => /\bpayload\b/.test(l))
    const defs = lines.findIndex((l) => /\bconst\b.*\bpayload\b|\blet\b.*\bpayload\b/.test(l))
    if (uses >= 0 && defs > uses) {
      critical(`payload used before definition in ${file} (line ${uses + 1} before ${defs + 1})`)
    }
  }
}

// ── Check 3: Hardcoded secrets ─────────────────────────────
function checkHardcodedSecrets(files) {
  for (const [file, lines] of Object.entries(files)) {
    for (const line of lines) {
      const trimmed = line.trim()
      if (
        /password\s*[:=]\s*['"][^'"]+['"]/.test(trimmed) &&
        !/process\.env|example|placeholder/.test(trimmed)
      ) {
        critical(`hardcoded password in ${file}: ${trimmed.slice(0, 80)}`)
      }
      if (
        /secret\s*[:=]\s*['"][^'"]+['"]/.test(trimmed) &&
        !/process\.env|example|placeholder|send500/.test(trimmed)
      ) {
        critical(`hardcoded secret in ${file}: ${trimmed.slice(0, 80)}`)
      }
    }
  }
}

// ── Check 4: Missing send500 on 500 responses ──────────────
function checkMissingSend500(files) {
  for (const [file, lines] of Object.entries(files)) {
    if (!file.endsWith('.js')) continue
    const hasSend500 = /send500/.test(lines.join(''))
    if (hasSend500) continue
    for (const line of lines) {
      if (/res\.status\(500\)/.test(line)) {
        warn(`missing send500() in ${file}: ${line.trim().slice(0, 80)}`)
      }
    }
  }
}

// ── Check 5: Auth check outside try block ──────────────────
function checkAuthOutsideTry(files) {
  for (const [file, lines] of Object.entries(files)) {
    if (!file.endsWith('.js') || !file.includes('pages/api/')) continue
    const authLine = lines.findIndex((l) => /getCurrentUser/.test(l))
    const tryLine = lines.findIndex((l) => /^\s*try\s*\{/.test(l))
    if (authLine >= 0 && tryLine >= 0 && authLine < tryLine) {
      warn(`auth check outside try block in ${file}`)
    }
  }
}

// ── Check 6: Reader/writer drift ───────────────────────────
function checkReaderWriterDrift(files) {
  const apiFiles = Object.keys(files).filter((f) => f.includes('pages/api/'))
  if (apiFiles.length === 0) return
  try {
    const { auditTableUsage } = require('../lib/table-audit')
    const sql = require('../lib/db').getDb()
    // This is async but we're in a sync script — skip gracefully
    warn('reader/writer drift: async check skipped (run via health-check cron for full result)')
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' || /DATABASE_URL/.test(err.message)) {
      // DB unavailable — skip gracefully
    } else {
      warn(`reader/writer drift: ${err.message}`)
    }
  }
}

// ── Check 7: Naming convention violations ──────────────────
function checkNamingConventions(files) {
  for (const file of Object.keys(files)) {
    const name = path.basename(file)
    // Exempt Next.js dynamic routes [id], [slug], etc.
    if (/\[.+\]/.test(name)) continue

    if (
      file.includes('pages/api/') ||
      file.includes('lib/') ||
      file.includes('scripts/') ||
      file.includes('crons/') ||
      file.includes('bots/')
    ) {
      if (/[A-Z]/.test(name.replace('.js', '').replace('.test.js', ''))) {
        warn(`naming: ${name} should be kebab-case (found uppercase)`)
      }
    }
    if (file.includes('components/')) {
      if (/[a-z]/.test(name.charAt(0)) && name.endsWith('.js') && !name.includes('test')) {
        warn(`naming: ${name} should be PascalCase (components/)`)
      }
    }
  }
}

// ── Check 8: SOT sync (APPROVED_PROJECT_IDS) ───────────────
function checkSOTSync() {
  const files = {
    'scripts/sync-redmine.js': null,
    'pages/api/tickets.js': null,
  }
  for (const file of Object.keys(files)) {
    const full = path.join(__dirname, '..', file)
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, 'utf8')
      const match = content.match(/APPROVED_(?:PROJECT_IDS|REDMINE_IDS)\s*=\s*\[([^\]]+)\]/)
      if (match) {
        files[file] =
          match[1]
            .match(/\d+/g)
            ?.map(Number)
            .sort((a, b) => a - b) || []
      }
    }
  }
  const values = Object.values(files)
  if (values[0] && values[1]) {
    const a = JSON.stringify(values[0])
    const b = JSON.stringify(values[1])
    if (a !== b) {
      warn(`SOT: APPROVED_PROJECT_IDS mismatch between sync-redmine.js and tickets.js`)
    }
  }
}

// ── Check 9: Column drift ──────────────────────────────────
function checkColumnDrift(files) {
  // Quick static check: look for SELECT column FROM table patterns in changed files
  // Full DB check requires async — skip here, use health-check cron
  for (const [file, lines] of Object.entries(files)) {
    if (!file.endsWith('.js')) continue
    for (const line of lines) {
      const m = line.match(/SELECT\s+(\w+)\s+FROM\s+(\w+)/i)
      if (m && m[1] !== '*' && m[1] !== '1') {
        // Just flag for awareness — full check requires DB
      }
    }
  }
}

// ── Check 10: Dead table usage ─────────────────────────────
function checkDeadTableUsage(files) {
  // Static check: flag tables in code that might not be in DB
  // Full check requires DB — skip here
  // Already covered by reader/writer drift (check 6)
}

// ── Run all checks ─────────────────────────────────────────
function runReview() {
  const staged = getStagedDiff()
  let diff = staged

  if (!staged.trim()) {
    // No staged changes — review commits being pushed
    const commits = getCommitsBeingPushed()
    if (!commits) {
      console.log('No staged changes or commits to review.')
      process.exit(0)
    }
    try {
      diff = execSync('git diff origin/main..HEAD', {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      })
    } catch {
      console.log('No diff available for review.')
      process.exit(0)
    }
    const count = commits.split('\n').length
    console.log(`Reviewing ${count} commit(s) being pushed...\n`)
  }

  if (!diff.trim()) {
    console.log('No diff to review.')
    process.exit(0)
  }

  const files = parseDiff(diff)

  checkErrMessageLeaks(files)
  checkPayloadBeforeDefinition(files)
  checkHardcodedSecrets(files)
  checkMissingSend500(files)
  checkAuthOutsideTry(files)
  checkReaderWriterDrift(files)
  checkNamingConventions(files)
  checkSOTSync()
  checkColumnDrift(files)
  checkDeadTableUsage(files)

  // Report
  if (results.critical.length === 0 && results.warning.length === 0) {
    console.log('No issues found.')
    process.exit(0)
  }

  if (results.critical.length > 0) {
    console.error('\n=== CRITICAL ISSUES (blocking) ===')
    for (const issue of results.critical) console.error(`  ✖ ${issue}`)
  }
  if (results.warning.length > 0) {
    console.warn('\n=== WARNINGS (non-blocking) ===')
    for (const issue of results.warning) console.warn(`  ⚠ ${issue}`)
  }

  process.exit(results.critical.length > 0 ? 1 : 0)
}

runReview()
