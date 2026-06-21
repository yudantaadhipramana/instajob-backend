const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const jobs = [
  { title: 'Senior React Developer', company: 'TechCorp', description: 'Build scalable web applications', location: 'Jakarta', salary_min: 120000000, salary_max: 180000000, remote: false },
  { title: 'Full Stack Engineer', company: 'StartupXYZ', description: 'Work on modern web stack', location: 'Remote', salary_min: 100000000, salary_max: 150000000, remote: true },
  { title: 'Backend Developer', company: 'FinanceFlow', description: 'Develop robust backend services', location: 'Bandung', salary_min: 110000000, salary_max: 160000000, remote: false },
  { title: 'Frontend Engineer', company: 'DesignStudio', description: 'Create beautiful UIs', location: 'Surabaya', salary_min: 90000000, salary_max: 140000000, remote: false },
  { title: 'DevOps Engineer', company: 'CloudSync', description: 'Manage infrastructure on AWS', location: 'Remote', salary_min: 130000000, salary_max: 190000000, remote: true },
  { title: 'Data Scientist', company: 'AI Solutions', description: 'Build ML models', location: 'Jakarta', salary_min: 140000000, salary_max: 200000000, remote: false },
  { title: 'QA Automation', company: 'SoftwareHub', description: 'Automate testing', location: 'Medan', salary_min: 80000000, salary_max: 120000000, remote: false },
  { title: 'Mobile Developer', company: 'AppFactory', description: 'Develop mobile apps', location: 'Jakarta', salary_min: 100000000, salary_max: 160000000, remote: false },
  { title: 'System Administrator', company: 'Enterprise Corp', description: 'Manage IT infrastructure', location: 'Remote', salary_min: 95000000, salary_max: 145000000, remote: true },
  { title: 'Product Manager', company: 'Innovation Lab', description: 'Lead product development', location: 'Jakarta', salary_min: 150000000, salary_max: 220000000, remote: false },
  { title: 'UX/UI Designer', company: 'Creative Agency', description: 'Design user interfaces', location: 'Yogyakarta', salary_min: 85000000, salary_max: 130000000, remote: false },
  { title: 'Database Administrator', company: 'DataVault', description: 'Manage databases', location: 'Remote', salary_min: 120000000, salary_max: 170000000, remote: true },
  { title: 'Security Engineer', company: 'CyberGuard', description: 'Implement security solutions', location: 'Jakarta', salary_min: 140000000, salary_max: 210000000, remote: false },
  { title: 'Machine Learning Engineer', company: 'AI Ventures', description: 'Develop ML pipelines', location: 'Bandung', salary_min: 130000000, salary_max: 190000000, remote: true },
  { title: 'Cloud Architect', company: 'CloudNative', description: 'Design cloud solutions', location: 'Remote', salary_min: 160000000, salary_max: 240000000, remote: true },
  { title: 'API Developer', company: 'TechServices', description: 'Build RESTful APIs', location: 'Surabaya', salary_min: 105000000, salary_max: 155000000, remote: false },
  { title: 'Platform Engineer', company: 'DevOps Plus', description: 'Build developer platforms', location: 'Jakarta', salary_min: 125000000, salary_max: 185000000, remote: false },
  { title: 'Solutions Architect', company: 'EnterpriseSoft', description: 'Design enterprise solutions', location: 'Remote', salary_min: 150000000, salary_max: 230000000, remote: true },
  { title: 'Junior Developer', company: 'CodeBootcamp', description: 'Learn and grow with mentorship', location: 'Jakarta', salary_min: 60000000, salary_max: 90000000, remote: false },
  { title: 'Technical Lead', company: 'ProductCorp', description: 'Lead engineering team', location: 'Jakarta', salary_min: 140000000, salary_max: 210000000, remote: false },
  { title: 'Blockchain Developer', company: 'CryptoLabs', description: 'Build smart contracts', location: 'Remote', salary_min: 120000000, salary_max: 180000000, remote: true },
  { title: 'Game Developer', company: 'GameStudio', description: 'Create engaging games', location: 'Jakarta', salary_min: 100000000, salary_max: 160000000, remote: false },
  { title: 'Data Engineer', company: 'BigData Inc', description: 'Build data pipelines', location: 'Bandung', salary_min: 115000000, salary_max: 170000000, remote: true },
  { title: 'Infrastructure Engineer', company: 'OpsCloud', description: 'Design cloud infrastructure', location: 'Remote', salary_min: 125000000, salary_max: 185000000, remote: true },
  { title: 'Software Architect', company: 'ArchitectureFirst', description: 'Design large-scale systems', location: 'Jakarta', salary_min: 160000000, salary_max: 250000000, remote: false },
];

async function insertJobs() {
  try {
    console.log('🔌 Connecting to database...');
    
    // Create Jobs table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Jobs" (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        company VARCHAR(255) NOT NULL,
        description TEXT,
        location VARCHAR(255),
        salary_min INTEGER,
        salary_max INTEGER,
        remote BOOLEAN DEFAULT false,
        "postedAt" TIMESTAMP DEFAULT NOW(),
        "createdAt" TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('📝 Inserting 25 jobs...');
    
    for (const job of jobs) {
      await pool.query(
        `INSERT INTO "Jobs" (title, company, description, location, salary_min, salary_max, remote) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [job.title, job.company, job.description, job.location, job.salary_min, job.salary_max, job.remote]
      );
    }
    
    // Verify data
    const result = await pool.query('SELECT COUNT(*) FROM "Jobs"');
    console.log(`✅ Jobs inserted! Total: ${result.rows[0].count}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

insertJobs();
