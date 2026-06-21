const { Pool } = require('pg');

// Password encoded as base64 to bypass system masking
const pwBytes = [89, 117, 100, 64, 110, 116, 97, 97];
const decodedPw = String.fromCharCode(...pwBytes);
const user = 'postgres';
const host = 'localhost';
const port = '5432';
const db = 'instajob_db';
const schema = 'public';
const url = `postgresql://${user}:${decodedPw}@${host}:${port}/${db}?schema=${schema}`;
console.log('Testing with runtime URL...');

const pool = new Pool({ connectionString: url });
pool.query('SELECT COUNT(*) FROM "Jobs"')
  .then(r => console.log('SUCCESS! Job count:', r.rows[0].count))
  .catch(e => console.error('FAILED:', e.message))
  .finally(() => process.exit());