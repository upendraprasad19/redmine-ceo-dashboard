#!/usr/bin/env node
/**
 * check-email-normalization.js
 * Gate: No raw thinking-code.com references in code or DB queries.
 * Violations: Un-normalized email domains that break lookups.
 */
const fs = require('fs')
const path = require('path')

const SRC_DIRS = ['pages', 'lib', 'scripts']
const FORBIDDEN_PATTERNS = [/thinking-code\.com/gi, /mail\.thinking-code\.com/gi]

function findJsFiles() {
  const files = []
  for (const dir of SRC_DIRS) {
    const fullPath = path.join(__dirname, '..', dir)
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
  const violations = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    for (const pattern of FORBIDDEN_PATTERNS) {
      const matches = content.match(pattern)
      if (matches) {
        violations.push({
          file: path.relative(path.join(__dirname, '..'), file),
          pattern: pattern.source,
          count: matches.length,
        })
      }
    }
  }

  if (violations.length > 0) {
    console.error('EMAIL NORMALIZATION — Raw thinking-code.com references found:')
    for (const v of violations) {
      console.error(`  - ${v.file} (${v.count}x pattern: ${v.pattern})`)
    }
    process.exit(1)
  }

  console.log('EMAIL NORMALIZATION — No raw thinking-code.com references')
}

main()
