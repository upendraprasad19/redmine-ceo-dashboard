/**
 * lib/table-audit.js
 * Pure audit logic for table usage across API routes.
 * Extracted from scripts/audit-readers-writers.js for reuse in health-check cron.
 *
 * Exports: auditTableUsage(sql) — async, returns clean report object.
 * No process.exit(), no console.log(), no side effects.
 */
const fs = require('fs')
const path = require('path')

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

async function auditTableUsage(sql) {
  const apiFiles = findApiFiles()

  if (apiFiles.length === 0) {
    return {
      ok: false,
      error: 'No API files found — possible deployment path mismatch',
      totalFiles: 0,
      phantomWrites: [],
      deadTables: [],
      readOnlyTables: [],
    }
  }

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

  const hasIssues = phantomWrites.length > 0 || deadTables.length > 0

  return {
    ok: !hasIssues,
    totalFiles: apiFiles.length,
    totalDbTables: dbTableNames.size,
    totalCodeTables: allUsedTables.size,
    phantomWrites,
    deadTables,
    readOnlyTables,
    reads: Object.fromEntries([...reads].map(([k, v]) => [k, [...v]])),
    writes: Object.fromEntries([...writes].map(([k, v]) => [k, [...v]])),
  }
}

module.exports = { auditTableUsage, findApiFiles, extractTableNames, classifyTableUsage }
