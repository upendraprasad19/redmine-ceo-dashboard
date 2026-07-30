#!/usr/bin/env node
/**
 * check-engineering-filter.js
 * Gate: Every "no time log" count query must filter by engineering-team whitelist.
 * Violations: Queries counting people without time logs that include non-engineering teams.
 */
const fs = require('fs')
const path = require('path')

const API_DIR = path.join(__dirname, '..', 'pages', 'api')
const WHITELIST = ['AI', 'DB', 'DevOps', 'JS/UI', 'Java', 'QA']

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

function hasTimeLogQuery(content) {
  return /haven.*logged.*time|no.*time.*log|not.*logged.*time/i.test(content)
}

function hasEngineeringFilter(content) {
  return (
    WHITELIST.some((team) => content.includes(`'${team}'`)) ||
    /team\s+IN\s*\(/i.test(content) ||
    /ANY\(\$1\)/i.test(content)
  )
}

function main() {
  const files = findApiFiles()
  const violations = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    if (hasTimeLogQuery(content) && !hasEngineeringFilter(content)) {
      violations.push(path.relative(path.join(__dirname, '..'), file))
    }
  }

  if (violations.length > 0) {
    console.error('ENGINEERING FILTER — Time-log queries without whitelist:')
    for (const v of violations) console.error(`  - ${v}`)
    console.error(`\nRequired whitelist: ${WHITELIST.join(', ')}`)
    process.exit(1)
  }

  console.log('ENGINEERING FILTER — All time-log queries have whitelist')
}

main()
