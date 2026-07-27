import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

async function verify() {
  // Active issues with DO
  const activeWithDO = await sql(
    "SELECT COUNT(*) as c FROM issues WHERE status NOT IN ('Closed','Resolved','Verified','Rejected') AND delivery_owner_ids IS NOT NULL",
  )
  console.log('Active issues WITH Delivery Owner:', activeWithDO[0].c)

  // Active issues without DO
  const activeNoDO = await sql(
    "SELECT COUNT(*) as c FROM issues WHERE status NOT IN ('Closed','Resolved','Verified','Rejected') AND delivery_owner_ids IS NULL",
  )
  console.log('Active issues WITHOUT Delivery Owner:', activeNoDO[0].c)

  // iCLAIMS 2.0 specifically
  const iclaims = await sql(
    "SELECT i.status, i.delivery_owner_ids IS NOT NULL as has_do, COUNT(*) as c FROM issues i JOIN projects p ON p.id=i.project_id WHERE p.name='iCLAIMS 2.0' AND i.status NOT IN ('Closed','Resolved','Verified','Rejected') GROUP BY i.status, has_do ORDER BY i.status",
  )
  console.log('\niCLAIMS 2.0 active issues:')
  iclaims.forEach((r) => console.log(`  ${r.status} hasDO=${r.has_do} count=${r.c}`))

  // Sample: iCLAIMS 2.0 issues with manager names
  const sample = await sql(
    "SELECT i.redmine_id, i.title, i.status, do_.names as manager FROM issues i LEFT JOIN LATERAL (SELECT STRING_AGG(u.name, ', ' ORDER BY u.name) AS names FROM unnest(COALESCE(i.delivery_owner_ids, ARRAY[]::int[])) AS oid JOIN users u ON u.id = oid) do_ ON true WHERE i.redmine_id IN (11521, 11550, 11547, 11381)",
  )
  console.log('\nSample iCLAIMS 2.0 issues:')
  sample.forEach((r) =>
    console.log(`  #${r.redmine_id} ${r.title} [${r.status}] Manager: ${r.manager}`),
  )

  // Check sync state
  const ss = await sql('SELECT * FROM sync_state')
  console.log('\nSync state:', JSON.stringify(ss, null, 2))
}
verify()
