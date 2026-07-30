#!/usr/bin/env node
/**
 * check-error-sanitization.js
 * Gate: All API routes must use send500() from lib/api-error.js.
 * Violations: Routes with err.message in responses or missing send500.
 */
const fs = require('fs')
const path = require('path')

const API_DIR = path.join(__dirname, '..', 'pages', 'api')

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

function hasSend500(content) {
  return content.includes('send500') || content.includes('sendError')
}

function hasErrMessageLeak(content) {
  const leakPatterns = [
    /res\.status\(\d+\)\.json\(\{[^}]*err\.message/,
    /res\.status\(\d+\)\.json\(\{[^}]*error\.message/,
    /res\.status\(\d+\)\.json\(\{[^}]*e\.message/,
    /res\.status\(\d+\)\.send\(err\.message/,
    /res\.status\(\d+\)\.send\(error\.message/,
  ]
  return leakPatterns.some((p) => p.test(content))
}

function main() {
  const files = findApiFiles()
  const noSend500 = []
  const leakFiles = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    const rel = path.relative(path.join(__dirname, '..'), file)
    if (!hasSend500(content)) noSend500.push(rel)
    if (hasErrMessageLeak(content)) leakFiles.push(rel)
  }

  let hasErrors = false

  if (leakFiles.length > 0) {
    console.error('ERROR SANITIZATION — err.message leaks found:')
    for (const v of leakFiles) console.error(`  - ${v}`)
    hasErrors = true
  }

  if (noSend500.length > 0) {
    console.error('\nERROR SANITIZATION — Routes without send500():')
    for (const v of noSend500) console.error(`  - ${v}`)
    hasErrors = true
  }

  if (hasErrors) process.exit(1)

  console.log('ERROR SANITIZATION — All routes use send500(), no err.message leaks')
}

main()
