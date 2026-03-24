const { config } = require('dotenv');
config({ path: '.env.local' });

async function check() {
  const urlBase = `${process.env.REDMINE_URL.replace(/\/$/, '')}`;
  const key = process.env.REDMINE_API_KEY;

  try {
    const rolesRes = await fetch(`${urlBase}/roles.json?key=${key}`);
    const rolesData = await rolesRes.json();
    console.log("ROLES:", JSON.stringify(rolesData, null, 2));
  } catch(e) { console.log('Roles error', e.message) }

  try {
    const groupsRes = await fetch(`${urlBase}/groups.json?key=${key}&include=users`);
    const groupsData = await groupsRes.json();
    console.log("GROUPS:", JSON.stringify(groupsData, null, 2));
  } catch(e) { console.log('Groups error', e.message) }
}

check();
