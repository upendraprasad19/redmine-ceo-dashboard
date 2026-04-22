// scripts/cleanup-before-oct1.js
// One-time cleanup: Delete all data before Oct 1, 2025 AND non-approved projects
// Usage: node scripts/cleanup-before-oct1.js

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const cutoff = '2025-10-01T00:00:00Z';

// Approved project IDs (from AppScript) - as PostgreSQL array literal
const APPROVED_IDS = '{2,3,5,7,14,15,16,17,18,19,20,21,23,29,34,43,44,47,49,50,51,55,56,57,60,61,62,63,65,67,68,69,70,71,72,73,74,75,76}';

async function cleanup() {
  console.log('🗑️  Deleting all data before Oct 1, 2025...');

  try {
    // Show what will be deleted (before cutoff OR not in approved projects)
    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM issues WHERE created_at < ${cutoff} OR project_id != ALL(${APPROVED_IDS}::int[]))::int AS old_issues,
        (SELECT COUNT(*) FROM issue_journals WHERE created_at < ${cutoff})::int AS old_journals,
        (SELECT COUNT(*) FROM time_entries WHERE created_at < ${cutoff})::int AS old_time_entries,
        (SELECT COUNT(*) FROM leave_records WHERE created_at < ${cutoff})::int AS old_leave_records,
        (SELECT COUNT(*) FROM projects WHERE redmine_id != ALL(${APPROVED_IDS}::int[]))::int AS bad_projects
    `;
    console.log('Records to delete:');
    console.log(`  • Issues (before Oct 1 OR non-approved): ${counts[0].old_issues}`);
    console.log(`  • Issue journals: ${counts[0].old_journals}`);
    console.log(`  • Time entries: ${counts[0].old_time_entries}`);
    console.log(`  • Leave records: ${counts[0].old_leave_records}`);
    console.log(`  • Non-approved projects: ${counts[0].bad_projects}`);

    // First get internal IDs of non-approved projects
    const badProjectIds = await sql`SELECT id FROM projects WHERE redmine_id != ALL(${APPROVED_IDS}::int[])`;
    const badProjectIdList = badProjectIds.map(p => p.id);
    
    if (badProjectIdList.length > 0) {
      console.log(`  Found ${badProjectIdList.length} non-approved project records to clean up`);
      
      // Get issue IDs for non-approved projects first
      const badIssueIds = await sql`SELECT id FROM issues WHERE project_id = ANY(${badProjectIdList})`;
      const badIssueIdList = badIssueIds.map(i => i.id);
      
      if (badIssueIdList.length > 0) {
        // Delete child records first (issue_team_history has FK to issues)
        let result = await sql`DELETE FROM issue_team_history WHERE issue_id = ANY(${badIssueIdList})`;
        console.log(`✓ Deleted ${result.count ?? 0} issue_team_history from non-approved projects`);
        
        result = await sql`DELETE FROM time_entries WHERE issue_id = ANY(${badIssueIdList})`;
        console.log(`✓ Deleted ${result.count ?? 0} time_entries from non-approved projects`);
        
        // Then delete issues
        result = await sql`DELETE FROM issues WHERE project_id = ANY(${badProjectIdList})`;
        console.log(`✓ Deleted ${result.count ?? 0} issues from non-approved projects`);
      }
    }

    // Delete time_entries before cutoff date
    let result = await sql`DELETE FROM time_entries WHERE created_at < ${cutoff}`;
    console.log(`✓ Deleted ${result.count ?? 0} time entries before cutoff`);

    // Delete issues before cutoff date (get IDs first for FK handling)
    const oldIssueIds = await sql`SELECT id FROM issues WHERE created_at < ${cutoff}`;
    const oldIssueIdList = oldIssueIds.map(i => i.id);
    if (oldIssueIdList.length > 0) {
      await sql`DELETE FROM issue_team_history WHERE issue_id = ANY(${oldIssueIdList})`;
      await sql`DELETE FROM time_entries WHERE issue_id = ANY(${oldIssueIdList})`;
    }
    result = await sql`DELETE FROM issues WHERE created_at < ${cutoff}`;
    console.log(`✓ Deleted ${result.count ?? 0} issues before cutoff`);

    // Then delete related records
    result = await sql`DELETE FROM issue_journals WHERE created_at < ${cutoff}`;
    console.log(`✓ Deleted ${result.count ?? 0} issue journals`);

    result = await sql`DELETE FROM issue_team_history WHERE issue_id NOT IN (SELECT id FROM issues)`;
    console.log(`✓ Deleted ${result.count ?? 0} orphaned issue team records`);

    result = await sql`DELETE FROM leave_records WHERE created_at < ${cutoff}`;
    console.log(`✓ Deleted ${result.count ?? 0} leave records`);

    // Now delete non-approved projects
    result = await sql`DELETE FROM projects WHERE redmine_id != ALL(${APPROVED_IDS}::int[])`;
    console.log(`✓ Deleted ${result.count ?? 0} projects`);

    // Show remaining stats
    const after = await sql`
      SELECT
        (SELECT COUNT(*) FROM issues)::int AS remaining_issues,
        (SELECT MIN(created_at) FROM issues)::text AS oldest_ticket
    `;
    console.log('Remaining data:');
    console.log(`  • Issues: ${after[0].remaining_issues}`);
    console.log(`  • Oldest ticket: ${after[0].oldest_ticket}`);
    console.log('✅ Cleanup complete!');
  } catch (err) {
    console.error('❌ Cleanup failed:', err.message);
    process.exit(1);
  }
}

cleanup();
