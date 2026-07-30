#!/usr/bin/env node
/**
 * check-approved-projects-sync.js
 * Gate: APPROVED_PROJECT_IDS must be identical across all files.
 * Source of truth: lib/constants.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const FILES = [
  { path: 'lib/constants.js', varName: 'APPROVED_PROJECT_IDS' },
  { path: 'scripts/sync-redmine.js', varName: 'APPROVED_PROJECT_IDS' },
  { path: 'scripts/sync-backfill.js', varName: 'APPROVED_PROJECT_IDS' },
  { path: 'pages/api/tickets.js', varName: 'APPROVED_REDMINE_IDS' },
  { path: 'pages/api/sync.js', varName: 'APPROVED_PROJECT_IDS' },
  { path: 'pages/api/overview.js', varName: 'APPROVED_REDMINE_IDS' },
  { path: 'pages/api/cron/morning-briefing.js', varName: 'APPROVED_REDMINE_IDS' },
  { path: 'pages/api/cron/friday-summary.js', varName: 'APPROVED_REDMINE_IDS' },
  { path: 'pages/api/pm-pulse/executive-snapshot.js', varName: 'APPROVED_REDMINE_IDS' },
  { path: 'pages/api/pm-pulse/anomalies.js', varName: 'APPROVED_REDMINE_IDS' },
  { path: 'crons/health-check.js', varName: 'APPROVED_PROJECT_IDS' },
  { path: 'crons/weekly-reconcile.js', varName: 'APPROVED_PROJECT_IDS' },
]

function extractProjectIds(content, varName) {
  // Try to find array or Set definition
  const patterns = [
    new RegExp(`${varName}\\s*=\\s*\\[([^\\]]+)\\]`, 's'),
    new RegExp(`const\\s+${varName}\\s*=\\s*\\[([^\\]]+)\\]`, 's'),
    new RegExp(`${varName}\\s*=\\s*new Set\\(\\[([^\\]]+)\\]\\)`, 's'),
    new RegExp(`const\\s+${varName}\\s*=\\s*new Set\\(\\[([^\\]]+)\\]\\)`, 's'),
  ]
  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match) {
      return match[1]
        .match(/\d+/g)
        ?.map(Number)
        .sort((a, b) => a - b)
    }
  }

  // Check if it imports from constants.js
  if (
    content.includes("require('../lib/constants')") ||
    content.includes('require("../lib/constants")') ||
    content.includes("require('../../lib/constants')") ||
    content.includes("require('../../../lib/constants')") ||
    content.includes("from '../lib/constants.js'") ||
    content.includes('from "../lib/constants.js"') ||
    content.includes("from '../../lib/constants.js'") ||
    content.includes("from '../../../lib/constants.js'")
  ) {
    // File imports from constants.js — read the source
    const constantsPath = path.join(ROOT, 'lib/constants.js')
    if (fs.existsSync(constantsPath)) {
      const constantsContent = fs.readFileSync(constantsPath, 'utf8')
      return extractProjectIds(constantsContent, varName)
    }
  }

  return null
}

function main() {
  const results = []
  const violations = []

  for (const file of FILES) {
    const fullPath = path.join(ROOT, file.path)
    if (!fs.existsSync(fullPath)) {
      violations.push(`Missing: ${file.path}`)
      continue
    }
    const content = fs.readFileSync(fullPath, 'utf8')
    const ids = extractProjectIds(content, file.varName)
    if (!ids) {
      violations.push(`Could not extract ${file.varName} from ${file.path}`)
      continue
    }
    results.push({ file: file.path, ids, key: ids.join(',') })
  }

  if (violations.length > 0) {
    console.error('APPROVED PROJECTS SYNC — Extraction errors:')
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }

  const uniqueKeys = [...new Set(results.map((r) => r.key))]
  if (uniqueKeys.length > 1) {
    console.error('APPROVED PROJECTS SYNC — Project IDs differ across files:')
    for (const r of results) {
      console.error(`  - ${r.file}: [${r.ids.join(', ')}]`)
    }
    process.exit(1)
  }

  console.log(
    `APPROVED PROJECTS SYNC — All ${FILES.length} files have identical IDs: [${results[0].ids.join(', ')}]`,
  )
}

main()
