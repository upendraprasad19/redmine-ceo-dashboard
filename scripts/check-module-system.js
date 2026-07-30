#!/usr/bin/env node
/**
 * check-module-system.js
 * Gate: CJS/ESM boundary enforcement per AGENTS.md §4.
 * Violations: require() in ESM files, import in CJS files.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

const CJS_DIRS = ['lib', 'scripts', 'bots', 'crons']
const ESM_DIRS = ['pages', 'tests']

function findFiles(dirs) {
  const files = []
  for (const dir of dirs) {
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

function hasRequire(content) {
  return /\brequire\s*\(/.test(content)
}

function hasImport(content) {
  return (
    /^\s*import\s+/.test(content) ||
    /^\s*import\s*\{/.test(content) ||
    /^\s*from\s+['"]/.test(content)
  )
}

function main() {
  const violations = []

  // Check CJS dirs for import statements
  const cjsFiles = findFiles(CJS_DIRS)
  for (const file of cjsFiles) {
    const content = fs.readFileSync(file, 'utf8')
    if (hasImport(content)) {
      violations.push({
        file: path.relative(ROOT, file),
        issue: 'ESM import in CJS directory',
      })
    }
  }

  // Check ESM dirs for require statements
  const esmFiles = findFiles(ESM_DIRS)
  for (const file of esmFiles) {
    const content = fs.readFileSync(file, 'utf8')
    if (hasRequire(content) && content.includes('require(')) {
      // Allow dynamic require in some cases
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*require\s*\(/.test(lines[i])) {
          violations.push({
            file: path.relative(ROOT, file),
            issue: `CJS require in ESM directory at line ${i + 1}`,
          })
          break
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('MODULE SYSTEM — CJS/ESM boundary violations:')
    for (const v of violations) {
      console.error(`  - ${v.file}: ${v.issue}`)
    }
    process.exit(1)
  }

  console.log('MODULE SYSTEM — CJS/ESM boundaries respected')
}

main()
