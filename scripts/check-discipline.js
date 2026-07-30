#!/usr/bin/env node
/**
 * scripts/check-discipline.js
 * Pre-commit discipline gate. Checks:
 * 1. If board/active/ has tasks, a plan file must exist for each
 * 2. vault/INDEX.md must have been modified in recent commits (freshness)
 * Exit 0 = pass, exit 1 = violation (with --warn, just prints warnings)
 */

const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const warn = process.argv.includes('--warn')
const boardDir = path.join(__dirname, '..', '.opencode', 'board')
const vaultIndex = path.join(__dirname, '..', '.opencode', 'vault', 'INDEX.md')
const activeDir = path.join(boardDir, 'active')

let violations = 0

// 1. Check active tasks have plan files
if (fs.existsSync(activeDir)) {
  const activeTasks = fs.readdirSync(activeDir).filter((f) => f.endsWith('.md'))
  for (const task of activeTasks) {
    const content = fs.readFileSync(path.join(activeDir, task), 'utf8')
    // T1/T2 tasks need plan content (look for "## Plan" or "## What" or "## Files")
    if (!content.match(/##\s*(Plan|What|Files|Why)/i)) {
      const msg = `DISCIPLINE: Active task ${task} has no plan section — T1/T2 requires a plan file`
      if (warn) {
        console.warn(`⚠  ${msg}`)
      } else {
        console.error(`✖ ${msg}`)
        violations++
      }
    }
  }
}

// 2. Check vault freshness — was INDEX.md modified in last 5 commits?
try {
  const vaultHistory = execSync('git log --oneline -5 -- .opencode/vault/INDEX.md', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
  if (!vaultHistory) {
    const msg = 'DISCIPLINE: vault/INDEX.md not updated in last 5 commits — may be stale'
    if (warn) {
      console.warn(`⚠  ${msg}`)
    } else {
      console.error(`✖ ${msg}`)
      violations++
    }
  }
} catch {
  // git not available, skip
}

// 3. Check board has no orphaned backlog items marked done
try {
  const doneDir = path.join(boardDir, 'done')
  if (fs.existsSync(doneDir)) {
    const doneTasks = fs.readdirSync(doneDir).filter((f) => f.endsWith('.md'))
    // Check INDEX.md lists them
    const indexContent = fs.readFileSync(path.join(boardDir, 'INDEX.md'), 'utf8')
    for (const task of doneTasks) {
      const slug = task.replace(/\.md$/, '').replace(/^\d+-/, '')
      if (!indexContent.includes(slug)) {
        const msg = `DISCIPLINE: Done task ${task} not in board INDEX.md`
        if (warn) {
          console.warn(`⚠  ${msg}`)
        } else {
          console.error(`✖ ${msg}`)
          violations++
        }
      }
    }
  }
} catch {
  // skip
}

if (violations > 0 && !warn) {
  console.error(`\n✖ ${violations} discipline violation(s) — fix before committing`)
  process.exit(1)
} else if (violations > 0) {
  console.log(`\n⚠  ${violations} discipline warning(s) (non-blocking)`)
}
