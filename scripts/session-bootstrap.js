#!/usr/bin/env node
/**
 * scripts/session-bootstrap.js
 * Run at session start to surface current state.
 * Outputs board status, vault freshness, and pending discipline items.
 */

const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const boardDir = path.join(__dirname, '..', '.opencode', 'board')
const vaultDir = path.join(__dirname, '..', '.opencode', 'vault')

console.log('═══════════════════════════════════════')
console.log('  SESSION BOOTSTRAP')
console.log('═══════════════════════════════════════')

// Board status
const activeDir = path.join(boardDir, 'active')
const backlogDir = path.join(boardDir, 'backlog')
const doneDir = path.join(boardDir, 'done')

const active = fs.existsSync(activeDir)
  ? fs.readdirSync(activeDir).filter((f) => f.endsWith('.md'))
  : []
const backlog = fs.existsSync(backlogDir)
  ? fs.readdirSync(backlogDir).filter((f) => f.endsWith('.md'))
  : []
const done = fs.existsSync(doneDir) ? fs.readdirSync(doneDir).filter((f) => f.endsWith('.md')) : []

console.log('')
console.log(`📋 Board: ${active.length} active, ${backlog.length} backlog, ${done.length} done`)

if (active.length > 0) {
  console.log('   Active tasks:')
  for (const task of active) {
    const content = fs.readFileSync(path.join(activeDir, task), 'utf8')
    const hasPlan = content.match(/##\s*(Plan|What|Files|Why)/i)
    console.log(`   ${hasPlan ? '✅' : '⚠️ '} ${task}`)
  }
}

// Vault freshness
try {
  const vaultHistory = execSync('git log --oneline -3 -- .opencode/vault/INDEX.md', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
  if (vaultHistory) {
    const lines = vaultHistory.split('\n')
    console.log(`\n📚 Vault: last updated ${lines[0]}`)
  } else {
    console.log('\n📚 Vault: ⚠️  no recent updates')
  }
} catch {
  console.log('\n📚 Vault: (git unavailable)')
}

// Discipline reminder
console.log('')
console.log('🔍 Discipline checklist:')
console.log('   □ Read board/INDEX.md')
console.log('   □ Read vault/INDEX.md')
console.log('   □ Check git status')
console.log('   □ Run env check (if DB work)')
console.log('   □ Plan file for T1/T2 tasks')
console.log('   □ Reviewer subagent for T2')
console.log('   □ User approval before building')
console.log('   □ Post-edit: tests, board, vault')
console.log('   □ Pre-commit: build, self-learning, code review')

console.log('')
console.log('═══════════════════════════════════════')
