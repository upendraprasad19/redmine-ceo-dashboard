const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

// Load environment variables from .env.local
const envFile = path.resolve(__dirname, '..', '.env.local')
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile })
}

async function initDb() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('Error: DATABASE_URL not found in .env.local')
    process.exit(1)
  }

  const client = new Client({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  })

  try {
    console.log('Connecting to database...')
    await client.connect()
    console.log('Connected successfully.')

    const schemaPath = path.resolve(__dirname, '..', 'scripts', 'schema.sql')
    console.log(`Reading schema from ${schemaPath}...`)
    const schemaSql = fs.readFileSync(schemaPath, 'utf8')

    console.log('Executing schema initialization...')
    await client.query(schemaSql)
    console.log('Database initialized successfully!')
  } catch (err) {
    console.error('Initialization failed:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

initDb()
