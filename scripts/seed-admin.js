/**
 * scripts/seed-admin.js
 * Seeds initial dashboard_users and default AI config.
 * Idempotent — safe to run multiple times (ON CONFLICT DO NOTHING).
 *
 * Usage:  node scripts/seed-admin.js
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const SALT_ROUNDS = 10;

async function seed() {
  console.log('=== Company OS — Seed Admin Users & AI Config ===\n');

  // ── 1. Seed dashboard users ──────────────────────────────────────

  const users = [
    {
      username: 'upendra',
      password: 'admin123',
      display_name: 'Upendra',
      role: 'manager',
      team: null,
      telegram_id: 8674834540,
    },
    {
      username: 'vivek',
      password: 'admin123',
      display_name: 'Vivek',
      role: 'team_lead',
      team: 'QA',
      telegram_id: 8600897389,
    },
    {
      username: 'deepak',
      password: '123456',
      display_name: 'Deepak',
      role: 'team_lead',
      team: 'DB',
      telegram_id: null,
    },
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, SALT_ROUNDS);

    try {
      await sql`
        INSERT INTO dashboard_users (username, password_hash, display_name, role, team, telegram_id)
        VALUES (${u.username}, ${hash}, ${u.display_name}, ${u.role}, ${u.team}, ${u.telegram_id})
        ON CONFLICT (username) DO NOTHING
      `;
      console.log(`  User "${u.username}" — seeded (or already exists)`);
    } catch (err) {
      console.error(`  User "${u.username}" — FAILED: ${err.message}`);
    }
  }

  // ── 2. Seed default AI config ────────────────────────────────────

  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const defaultModel = process.env.AI_DEFAULT_MODEL || 'anthropic/claude-sonnet-4';

  if (!apiKey) {
    console.log('\n  Skipping AI config seed — OPENROUTER_API_KEY not set in .env.local');
  } else {
    try {
      // Only insert if no active config exists yet
      await sql`
        INSERT INTO ai_config (provider, api_key, base_url, default_model, is_active)
        SELECT 'openrouter', ${apiKey}, ${baseUrl}, ${defaultModel}, true
        WHERE NOT EXISTS (SELECT 1 FROM ai_config WHERE is_active = true)
      `;
      console.log('  AI config — seeded (or already exists)');
    } catch (err) {
      console.error(`  AI config — FAILED: ${err.message}`);
    }
  }

  console.log('\n=== Seed complete ===');
}

seed().catch(err => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
