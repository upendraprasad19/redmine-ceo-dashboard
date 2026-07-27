const { config } = require('dotenv')
config({ path: '.env.local' })
const REDMINE_URL = process.env.REDMINE_URL.replace(/\/$/, '')
const REDMINE_KEY = process.env.REDMINE_API_KEY

async function check() {
  const url = `${REDMINE_URL}/custom_fields.json?key=${REDMINE_KEY}`
  const res = await fetch(url)
  const data = await res.json()
  console.log(JSON.stringify(data, null, 2))
}
check()
