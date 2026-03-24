import { neon } from '@neondatabase/serverless';

// Single connection instance reused across serverless calls
let sql;

export function getDb() {
  if (!sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}
