#!/usr/bin/env node
/**
 * scripts/validate-audit-closure.js
 * Validates docs/audit/closures.yaml — every item must have a terminal_state.
 * Terminal states: closed_in_commit | upstream_blocked | verified_clean
 * Accepts --warn flag for non-blocking mode during baseline soak.
 */
const fs = require('fs')
const path = require('path')

const VALID_STATES = ['closed_in_commit', 'upstream_blocked', 'verified_clean']
const CLOSURES_PATH = path.join(__dirname, '..', 'docs', 'audit', 'closures.yaml')

function run() {
  const warnOnly = process.argv.includes('--warn')

  // File missing — not an error (no batches yet)
  if (!fs.existsSync(CLOSURES_PATH)) {
    process.exit(0)
  }

  const content = fs.readFileSync(CLOSURES_PATH, 'utf8')
  if (content.trim().length === 0 || content.trim() === 'batches: []') {
    process.exit(0)
  }

  const errors = []

  // Simple regex-based parse of our flat schema:
  // Each item block starts with "- id:" or "    - id:"
  const itemPattern = /- id:\s*(\S+)/g
  const statePattern = /terminal_state:\s*(\S+)/g

  // Split into batch blocks and scan each
  const lines = content.split('\n')
  let currentBatch = ''
  let currentItem = ''
  let currentId = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // Track batch name
    const batchMatch = trimmed.match(/^- batch:\s*(.+)/)
    if (batchMatch) {
      currentBatch = batchMatch[1]
      continue
    }

    // Track item ID
    const idMatch = trimmed.match(/^- id:\s*(\S+)/)
    if (idMatch) {
      currentId = idMatch[1]
      currentItem = ''
      continue
    }

    // Track terminal state
    const stateMatch = trimmed.match(/^terminal_state:\s*(\S+)/)
    if (stateMatch && currentId) {
      const state = stateMatch[1]
      if (!VALID_STATES.includes(state)) {
        errors.push(`Invalid terminal_state "${state}" for item ${currentId}`)
      }
      currentId = '' // reset after finding state
      continue
    }

    // If we have a current ID and hit another item/block, the previous item had no state
    if (currentId && (trimmed.startsWith('- id:') || trimmed.startsWith('batch:'))) {
      errors.push(`Item ${currentId} missing terminal_state`)
      currentId = ''
    }
  }

  // Check if last item had no state
  if (currentId) {
    errors.push(`Item ${currentId} missing terminal_state`)
  }

  if (errors.length === 0) process.exit(0)

  console.error('\n=== AUDIT CLOSURE ISSUES ===')
  for (const e of errors) console.error(`  \u2716 ${e}`)

  if (warnOnly) {
    console.log('Audit closure warnings only — not blocking.')
    process.exit(0)
  }
  process.exit(1)
}

run()
