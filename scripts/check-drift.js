#!/usr/bin/env node
/**
 * check-drift.js
 * Compares schema/contract.sql against the actual database schema.
 * Exits 0 if no drift, 1 if drift detected.
 * Run: node scripts/check-drift.js
 */
const { config } = require('dotenv')
config({ path: '.env.local' })

const { getDb } = require('../lib/db')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const warnOnly = args.includes('--warn')

async function checkDrift() {
  const contractPath = path.join(__dirname, '..', 'schema', 'contract.sql')
  if (!fs.existsSync(contractPath)) {
    console.error('No schema/contract.sql found. Run: node scripts/generate-schema-contract.js')
    process.exit(1)
  }

  const contract = fs.readFileSync(contractPath, 'utf8')
  let sql
  try {
    sql = getDb()
  } catch (err) {
    if (warnOnly) {
      console.warn('Drift check skipped: DB unavailable')
      process.exit(0)
    }
    console.error('Drift check failed:', err.message)
    process.exit(1)
  }

  const expectedTables = []
  const tableRegex = /CREATE TABLE (\w+) \(/g
  let match
  while ((match = tableRegex.exec(contract)) !== null) {
    expectedTables.push(match[1])
  }

  const actualTables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `
  const actualTableNames = actualTables.map((r) => r.table_name)

  let drift = false
  const issues = []

  const missingInDb = expectedTables.filter((t) => !actualTableNames.includes(t))
  const extraInDb = actualTableNames.filter((t) => !expectedTables.includes(t))

  if (missingInDb.length > 0) {
    drift = true
    issues.push(`Tables in contract but missing from DB: ${missingInDb.join(', ')}`)
  }
  if (extraInDb.length > 0) {
    drift = true
    issues.push(`Tables in DB but not in contract: ${extraInDb.join(', ')}`)
  }

  for (const tableName of expectedTables) {
    if (!actualTableNames.includes(tableName)) continue

    const columnRegex = new RegExp(`CREATE TABLE ${tableName}\\s*\\(([\\s\\S]*?)\\);`, 'g')
    const colMatch = columnRegex.exec(contract)
    if (!colMatch) continue

    const expectedColumns = []
    const colDefs = colMatch[1].split(',').map((s) => s.trim())
    for (const def of colDefs) {
      const colNameMatch = def.match(/^(\w+)\s/)
      if (colNameMatch) {
        expectedColumns.push(colNameMatch[1])
      }
    }

    const actualColumns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
      ORDER BY ordinal_position
    `
    const actualColumnNames = actualColumns.map((r) => r.column_name)

    const missingCols = expectedColumns.filter((c) => !actualColumnNames.includes(c))
    const extraCols = actualColumnNames.filter((c) => !expectedColumns.includes(c))

    if (missingCols.length > 0) {
      drift = true
      issues.push(
        `${tableName}: columns in contract but missing from DB: ${missingCols.join(', ')}`,
      )
    }
    if (extraCols.length > 0) {
      drift = true
      issues.push(`${tableName}: columns in DB but not in contract: ${extraCols.join(', ')}`)
    }
  }

  if (drift) {
    console.error('SCHEMA DRIFT DETECTED:')
    for (const issue of issues) {
      console.error(`  - ${issue}`)
    }
    process.exit(1)
  } else {
    console.log('No schema drift detected.')
    process.exit(0)
  }
}

checkDrift().catch((err) => {
  if (warnOnly) {
    console.warn('Drift check skipped:', err.message)
    process.exit(0)
  }
  console.error('Drift check failed:', err.message)
  process.exit(1)
})
