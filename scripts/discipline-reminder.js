#!/usr/bin/env node
/**
 * scripts/discipline-reminder.js
 * Session-start discipline injection: reads board/vault/git state and prints
 * context. Called from hooks.yaml as an ADDITIONAL action after the existing
 * inline bash that prints Next Task, Vault, Git, and Staged.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const BOARD_DIR = path.join(__dirname, '..', '.opencode', 'board')
const VAULT_INDEX = path.join(__dirname, '..', '.opencode', 'vault', 'INDEX.md')

function countFiles(dir) {
  try {
    return fs.readdirSync(path.join(BOARD_DIR, dir)).filter((f) => f.endsWith('.md')).length
  } catch {
    return 0
  }
}

function daysSinceLastCommit() {
  try {
    const output = execSync('git log -1 --format=%ci', { encoding: 'utf8' }).trim()
    if (!output) return '?'
    const lastDate = new Date(output)
    const now = new Date()
    const diffMs = now - lastDate
    return String(Math.floor(diffMs / (1000 * 60 * 60 * 24)))
  } catch {
    return '?'
  }
}

function vaultLastUpdated() {
  try {
    const stat = fs.statSync(VAULT_INDEX)
    return stat.mtime.toISOString().slice(0, 10)
  } catch {
    return '?'
  }
}

function run() {
  const active = countFiles('active')
  const backlog = countFiles('backlog')
  const days = daysSinceLastCommit()
  const vaultDate = vaultLastUpdated()

  console.log('=== Discipline ===')
  console.log(`  Active tasks: ${active}  Backlog: ${backlog}`)
  console.log(`  Days since last commit: ${days}`)
  console.log(`  Vault last updated: ${vaultDate}`)
  console.log(
    '  Pre-commit gates: lint-staged \u2192 gitleaks \u2192 board validate \u2192 drift check \u2192 deferral gate \u2192 audit closure',
  )
  console.log(
    '  Pre-push gates: blast-radius \u2192 [feature: skip] / [account: tests + build + review-diff]',
  )
}

run()
