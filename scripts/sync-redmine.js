/**
 * scripts/sync-redmine.js
 *
 * CLI wrapper for local / manual sync runs.
 * The actual sync logic lives in lib/sync-engine.js.
 *
 * Usage:
 *   node scripts/sync-redmine.js          → full sync (default)
 *   node scripts/sync-redmine.js delta    → delta sync (changed since last run)
 *   node scripts/sync-redmine.js full     → explicit full sync
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { runSync } from '../lib/sync-engine.js';

const mode = process.argv[2] === 'delta' ? 'delta' : 'full';
const sql  = neon(process.env.DATABASE_URL);

runSync(mode, sql, msg => console.log(msg))
  .then(result => {
    console.log(`\n✅ Done. Mode: ${result.mode}, elapsed: ${result.elapsed}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Sync failed:', err.message);
    process.exit(1);
  });
