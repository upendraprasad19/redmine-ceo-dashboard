#!/usr/bin/env node
/**
 * audit-readers-writers.js
 * Scans API routes for SQL queries, extracts table names, compares against DB.
 * Reports: phantom writes, dead tables, read-only tables.
 * Run: node scripts/audit-readers-writers.js
 */
const { config } = require('dotenv')
config({ path: '.env.local' })

const { getDb } = require('../lib/db')
const fs = require('fs')
const path = require('path')
const glob = require('glob') || { sync: (p) => require('fs').readdirSync(p) }

function findApiFiles() {
  const apiDir = path.join(__dirname, '..', 'pages', 'api')
  const files = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.js')) {
        files.push(full)
      }
    }
  }
  walk(apiDir)
  return files
}

function extractTableNames(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const tables = new Set()

  const queryPatterns = [
    /(?:pool|client|sql)\s*\.\s*(?:query|unsafe)\s*\(\s*[`'"](.+?)[`'"]/gs,
    /FROM\s+(\w+)/gi,
    /INTO\s+(\w+)/gi,
    /UPDATE\s+(\w+)/gi,
    /JOIN\s+(\w+)/gi,
  ]

  for (const pattern of queryPatterns) {
    let m
    while ((m = pattern.exec(content)) !== null) {
      const name = m[1].toLowerCase()
      if (
        !name.startsWith('information_schema') &&
        !name.startsWith('pg_') &&
        name !== 'select' &&
        name !== 'where' &&
        name.length > 2
      ) {
        tables.add(name)
      }
    }
  }
  return tables
}

function classifyTableUsage(apiFiles) {
  const reads = new Map()
  const writes = new Map()

  const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'ON CONFLICT']
  const readKeywords = ['SELECT', 'FROM', 'JOIN']

  for (const file of apiFiles) {
    const content = fs.readFileSync(file, 'utf8').toUpperCase()
    const tables = extractTableNames(file)
    const relPath = path.relative(path.join(__dirname, '..'), file)

    for (const table of tables) {
      const hasWrite = writeKeywords.some(
        (kw) => content.includes(kw) && content.includes(table.toUpperCase()),
      )
      const hasRead = readKeywords.some(
        (kw) => content.includes(kw) && content.includes(table.toUpperCase()),
      )

      if (hasWrite) {
        if (!writes.has(table)) writes.set(table, new Set())
        writes.get(table).add(relPath)
      }
      if (hasRead) {
        if (!reads.has(table)) reads.set(table, new Set())
        reads.get(table).add(relPath)
      }
    }
  }

  return { reads, writes }
}

async function audit() {
  const sql = getDb()
  const apiFiles = findApiFiles()
  const { reads, writes } = classifyTableUsage(apiFiles)

  const dbTables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `
  const dbTableNames = new Set(dbTables.map((r) => r.table_name))

  const allUsedTables = new Set([...reads.keys(), ...writes.keys()])

  const phantomWrites = []
  const deadTables = []
  const readOnlyTables = []

  for (const table of dbTableNames) {
    if (!allUsedTables.has(table)) {
      deadTables.push(table)
    } else if (reads.has(table) && !writes.has(table)) {
      readOnlyTables.push(table)
    }
  }

  for (const table of allUsedTables) {
    if (!dbTableNames.has(table)) {
      phantomWrites.push(table)
    }
  }

  console.log('=== Readers/Writers Audit ===\n')
  console.log(`API files scanned: ${apiFiles.length}`)
  console.log(`DB tables: ${dbTableNames.size}`)
  console.log(`Tables referenced in code: ${allUsedTables.size}\n`)

  console.log('Table Usage:')
  console.log('-'.repeat(60))
  for (const table of [...dbTableNames].sort()) {
    const readers = reads.get(table)
    const writers = writes.get(table)
    const status = !allUsedTables.has(table)
      ? ' [DEAD]'
      : reads.has(table) && !writes.has(table)
        ? ' [READ-ONLY]'
        : ''
    console.log(`  ${table}${status}`)
    if (readers) console.log(`    Reads:  ${[...readers].join(', ')}`)
    if (writers) console.log(`    Writes: ${[...writers].join(', ')}`)
  }

  let exitCode = 0
  if (phantomWrites.length > 0) {
    console.error('\nPHANTOM WRITES (code references table not in DB):')
    for (const t of phantomWrites) console.error(`  - ${t}`)
    exitCode = 1
  }
  if (deadTables.length > 0) {
    console.error('\nDEAD TABLES (in DB but not referenced in code):')
    for (const t of deadTables) console.error(`  - ${t}`)
  }
  if (readOnlyTables.length > 0) {
    console.log('\nREAD-ONLY TABLES (in DB, read but never written):')
    for (const t of readOnlyTables) console.log(`  - ${t}`)
  }

  process.exit(exitCode)
}

audit().catch((err) => {
  console.error('Audit failed:', err.message)
  process.exit(1)
})
