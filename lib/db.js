const { neon } = require('@neondatabase/serverless')

// Single connection instance reused across serverless calls
let sql

function getDb() {
  if (!sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    sql = neon(process.env.DATABASE_URL)
  }
  return sql
}

function formatVector(floatArray) {
  return `[${floatArray.join(',')}]`
}

module.exports = { getDb, formatVector }
