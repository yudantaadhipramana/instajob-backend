require('dotenv').config();
const { Client } = require('pg');
const connStr = process.env.DATABASE_URL;
console.log('Trying:', connStr.replace(/postgres:.*@/, 'postgres:***@'));
const c = new Client({ connectionString: connStr });
c.connect()
  .then(() => { console.log('✅ Connected'); c.end(); process.exit(0); })
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
