#!/usr/bin/env node
/**
 * scripts/check-no-deferral.js
 * Pre-commit gate: scans staged .md files for deferral-euphemism language.
 * Exits 1 if banned phrases found in staged markdown additions.
 * Scans .md files only — JS files excluded to avoid false positives
 * on keywords like `function defer()`.
 */
const { execSync } = require('child_process')

const BANNED = [
  /\bdefer(?:red|ring|ral|rals)?\b/i,
  /\bfollow[- ]up\s+batch\b/i,
  /\bdedicated\s+batch\b/i,
  /\bcleanup\s+batch\b/i,
  /\btest[- ]maintenance\s+batch\b/i,
  /\blower\s+priority\b/i,
  /\bresponsible\s+handoff\b/i,
  /\bcontext\s+tight\b/i,
  /\bnext\s+batch\b/i,
  /\bcan\s+be\s+folded\s+into\b/i,
]

function getStagedMdFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
    return output
      .trim()
      .split('\n')
      .filter((f) => f.endsWith('.md') && f.length > 0)
  } catch {
    return []
  }
}

function getStagedDiffForFile(file) {
  try {
    const output = execSync(`git diff --cached --unified=0 -- "${file}"`, {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    })
    const addedLines = []
    for (const line of output.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        addedLines.push(line.slice(1))
      }
    }
    return addedLines
  } catch {
    return []
  }
}

function checkFile(file) {
  const violations = []
  const lines = getStagedDiffForFile(file)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pattern of BANNED) {
      if (pattern.test(line)) {
        violations.push({
          file,
          line: line.trim().slice(0, 100),
          pattern: pattern.source.slice(0, 40),
        })
        break // one violation per line is enough
      }
    }
  }

  return violations
}

function run() {
  const files = getStagedMdFiles()
  if (files.length === 0) process.exit(0)

  const all = []
  for (const file of files) {
    all.push(...checkFile(file))
  }

  if (all.length === 0) process.exit(0)

  console.error('\n=== DEFERRAL EUPHEMISMS (blocking) ===')
  for (const v of all) {
    console.error(`  \u2716 ${v.file}: ${v.line}`)
  }
  console.error('\n  See CLAUDE.md for the no-deferrals policy.')
  process.exit(1)
}

run()
