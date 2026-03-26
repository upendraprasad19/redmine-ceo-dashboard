/**
 * scripts/migrate.js
 * Runs all SQL migrations in order against the Neon PostgreSQL database.
 *
 * Usage:  node scripts/migrate.js
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

/**
 * Split SQL into individual statements, respecting $$ blocks and DO blocks.
 */
function splitStatements(content) {
  const statements = [];
  let current = '';
  let inDollarBlock = false;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comment-only lines at top level
    if (!inDollarBlock && trimmed.startsWith('--') && current.trim() === '') continue;

    // Track $$ blocks (function bodies, DO blocks)
    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 !== 0) {
      inDollarBlock = !inDollarBlock;
    }

    current += line + '\n';

    // If we're not inside a $$ block and line ends with ;, split here
    if (!inDollarBlock && trimmed.endsWith(';')) {
      const stmt = current.trim();
      if (stmt && stmt !== ';') statements.push(stmt);
      current = '';
    }
  }

  // Catch any trailing statement without ;
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function runMigrations() {
  console.log('=== Company OS — Database Migrations ===\n');

  // Read all .sql files sorted alphabetically (001, 002, ...)
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  console.log(`Found ${files.length} migration(s) to run.\n`);

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sqlContent = readFileSync(filePath, 'utf-8');

    process.stdout.write(`Running migration ${file}... `);

    try {
      // Neon serverless driver doesn't support multiple statements in one call.
      // Split by semicolons, but respect $$ blocks (PL/pgSQL function bodies).
      const statements = splitStatements(sqlContent);
      for (const stmt of statements) {
        if (stmt.trim()) await sql(stmt);
      }
      console.log('done');
      passed++;
    } catch (err) {
      console.log('FAILED');
      console.error(`  Error: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n=== Migrations complete: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

runMigrations().catch(err => {
  console.error('Fatal error running migrations:', err);
  process.exit(1);
});
