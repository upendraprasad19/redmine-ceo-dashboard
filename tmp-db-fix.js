const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });
const sql = neon(process.env.DATABASE_URL);

async function fix() {
  await sql("UPDATE users SET team = 'Engineering' WHERE team IS NULL");
  await sql("UPDATE users SET role = 'Member' WHERE role IS NULL");
  console.log('Fixed users team/role');
}
fix();
