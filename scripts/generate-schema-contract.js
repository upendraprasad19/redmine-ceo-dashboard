#!/usr/bin/env node
/**
 * generate-schema-contract.js
 * Generates schema/contract.sql from the current database schema.
 * Run: node scripts/generate-schema-contract.js
 */
const { config } = require('dotenv')
config({ path: '.env.local' })

const { getDb } = require('../lib/db')
const fs = require('fs')
const path = require('path')

async function generateContract() {
  const sql = getDb()

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `

  let contract = '-- Schema contract generated from database\n'
  contract += `-- Generated: ${new Date().toISOString()}\n`
  contract += '-- This file is the source of truth for expected DB schema.\n'
  contract += '-- Run: node scripts/generate-schema-contract.js to regenerate.\n\n'

  for (const { table_name } of tables) {
    const columns = await sql`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table_name}
      ORDER BY ordinal_position
    `

    contract += `CREATE TABLE ${table_name} (\n`
    const defs = []
    for (const col of columns) {
      let def = `  ${col.column_name} ${col.data_type}`
      if (col.character_maximum_length) {
        def += `(${col.character_maximum_length})`
      }
      if (col.is_nullable === 'NO') {
        def += ' NOT NULL'
      }
      if (col.column_default) {
        def += ` DEFAULT ${col.column_default}`
      }
      defs.push(def)
    }
    contract += defs.join(',\n')
    contract += '\n);\n\n'

    const indexes = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = ${table_name}
        AND schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname
    `

    for (const idx of indexes) {
      contract += `${idx.indexdef};\n`
    }
    if (indexes.length > 0) contract += '\n'
  }

  const outDir = path.join(__dirname, '..', 'schema')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const outPath = path.join(outDir, 'contract.sql')
  fs.writeFileSync(outPath, contract, 'utf8')
  console.log(`Schema contract written to ${outPath}`)
  console.log(`Tables: ${tables.length}`)
}

generateContract().catch((err) => {
  console.error('Failed to generate schema contract:', err.message)
  process.exit(1)
})
