const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Read DATABASE_URL from environment or use default
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:instajob_pass_2026@localhost:5432/instajob_db';

const pool = new Pool({ connectionString });

async function seedDatabase() {
  try {
    console.log('🔌 Connecting to database...');
    
    // Read SQL file
    const sqlPath = path.join(__dirname, 'prisma', 'seed.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📝 Executing seed SQL...');
    await pool.query(sql);
    
    console.log('✅ Database seeded successfully!');
    
    // Verify data
    const result = await pool.query('SELECT COUNT(*) FROM "Jobs"');
    console.log(`📊 Total jobs in database: ${result.rows[0].count}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }
}

seedDatabase();
