const { config } = require('dotenv');
config({ path: '.env.local' });

async function check() {
  const url = `${process.env.REDMINE_URL.replace(/\/$/, '')}/users.json?include=memberships,groups&limit=3&key=${process.env.REDMINE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data.users[0], null, 2));
}

check();
