#!/usr/bin/env node
/**
 * audit-readers-writers.js
 * CLI wrapper around lib/table-audit.js.
 * Run: node scripts/audit-readers-writers.js
 */
const { config } = require('dotenv')
config({ path: '.env.local' })

const { getDb } = require('../lib/db')
const { auditTableUsage } = require('../lib/table-audit')

async function main() {
  const sql = getDb()
  const report = await auditTableUsage(sql)

  console.log('=== Readers/Writers Audit ===\n')
  console.log(`API files scanned: ${report.totalFiles}`)
  console.log(`DB tables: ${report.totalDbTables}`)
  console.log(`Tables referenced in code: ${report.totalCodeTables}\n`)

  if (!report.ok && report.error) {
    console.error(`ERROR: ${report.error}`)
    process.exit(1)
  }

  console.log('Table Usage:')
  console.log('-'.repeat(60))
  for (const table of Object.keys({ ...report.reads, ...report.writes }).sort()) {
    const readers = report.reads[table]
    const writers = report.writes[table]
    const isDead = report.deadTables.includes(table)
    const isReadOnly = report.readOnlyTables.includes(table)
    const status = isDead ? ' [DEAD]' : isReadOnly ? ' [READ-ONLY]' : ''
    console.log(`  ${table}${status}`)
    if (readers) console.log(`    Reads:  ${readers.join(', ')}`)
    if (writers) console.log(`    Writes: ${writers.join(', ')}`)
  }

  let exitCode = 0
  if (report.phantomWrites.length > 0) {
    console.error('\nPHANTOM WRITES (code references table not in DB):')
    for (const t of report.phantomWrites) console.error(`  - ${t}`)
    exitCode = 1
  }
  if (report.deadTables.length > 0) {
    console.error('\nDEAD TABLES (in DB but not referenced in code):')
    for (const t of report.deadTables) console.error(`  - ${t}`)
  }
  if (report.readOnlyTables.length > 0) {
    console.log('\nREAD-ONLY TABLES (in DB, read but never written):')
    for (const t of report.readOnlyTables) console.log(`  - ${t}`)
  }

  process.exit(exitCode)
}

main().catch((err) => {
  console.error('Audit failed:', err.message)
  process.exit(1)
})
