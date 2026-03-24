import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
config({ path: '.env.local' });
const sql = neon(process.env.DATABASE_URL);
async function run() {
  const r = await sql`SELECT name, email FROM users WHERE name ILIKE '%Upendra%'`;
  console.log(r);
}
run();
