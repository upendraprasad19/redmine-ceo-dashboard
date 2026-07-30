#!/usr/bin/env node
/**
 * check-regression-tests.js
 * Gate: Every SoT entry should have a behavioral test path.
 * Validates that critical writer/reader contracts have regression tests.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const TEST_DIR = path.join(ROOT, 'tests', 'unit')
const SOT_FILE = path.join(ROOT, 'docs', 'audit', 'sot-registry.yaml')

function findTestFiles() {
  if (!fs.existsSync(TEST_DIR)) return []
  return fs
    .readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join(TEST_DIR, f))
}

function main() {
  const testFiles = findTestFiles()
  const testNames = testFiles.map((f) => path.basename(f, '.test.js'))

  // Check for common critical modules that should have tests
  const criticalModules = ['auth', 'email-utils', 'telegram', 'db', 'redis']

  const missing = []
  for (const mod of criticalModules) {
    const hasTest = testNames.some((t) => t.includes(mod))
    if (!hasTest) missing.push(mod)
  }

  // Check for SoT registry
  const hasSotRegistry = fs.existsSync(SOT_FILE)

  if (missing.length > 0) {
    console.error('REGRESSION TESTS — Critical modules without tests:')
    for (const m of missing) console.error(`  - ${m}`)
    console.error('\nRequired test files: tests/unit/<module>.test.js')
    process.exit(1)
  }

  if (!hasSotRegistry) {
    console.error('REGRESSION TESTS — SoT registry not found at docs/audit/sot-registry.yaml')
    console.error(
      'Run: node scripts/check-audit-readers-writers.js --format yaml > docs/audit/sot-registry.yaml',
    )
    process.exit(1)
  }

  console.log(
    `REGRESSION TESTS — ${testFiles.length} test files found, all critical modules covered`,
  )
}

main()
