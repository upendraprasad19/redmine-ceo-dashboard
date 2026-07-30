#!/usr/bin/env node
/**
 * check-constant-drift.js
 * Gate: Detect duplicated constants across files.
 * Violations: Status maps, team names, role values defined in multiple places.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC_DIRS = ['pages', 'lib', 'scripts']

const CONSTANT_PATTERNS = [
  { name: 'Status Map', pattern: /(?:const|let|var)\s+STATUS_MAP\s*=/g },
  { name: 'Team Names', pattern: /(?:const|let|var)\s+(?:TEAM_NAMES|EXPECTED_TIME_TEAMS)\s*=/g },
  { name: 'Role Values', pattern: /(?:const|let|var)\s+(?:ROLES|USER_ROLES)\s*=/g },
  {
    name: 'Project IDs',
    pattern: /(?:const|let|var)\s+(?:APPROVED_PROJECT_IDS|APPROVED_REDMINE_IDS)\s*=/g,
  },
]

function findJsFiles() {
  const files = []
  for (const dir of SRC_DIRS) {
    const fullPath = path.join(ROOT, dir)
    if (!fs.existsSync(fullPath)) continue
    function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.js')) files.push(full)
      }
    }
    walk(fullPath)
  }
  return files
}

function main() {
  const files = findJsFiles()
  const findings = []

  for (const { name, pattern } of CONSTANT_PATTERNS) {
    const matches = []
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      const fileMatches = content.match(new RegExp(pattern.source, 'g'))
      if (fileMatches) {
        matches.push({
          file: path.relative(ROOT, file),
          count: fileMatches.length,
        })
      }
    }
    if (matches.length > 1) {
      findings.push({ name, files: matches })
    }
  }

  if (findings.length > 0) {
    console.error('CONSTANT DRIFT — Duplicated constants found:')
    for (const f of findings) {
      console.error(`\n  ${f.name}:`)
      for (const m of f.files) {
        console.error(`    - ${m.file} (${m.count}x)`)
      }
    }
    process.exit(1)
  }

  console.log('CONSTANT DRIFT — No duplicated constants detected')
}

main()
