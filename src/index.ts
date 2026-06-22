// dotenv/config removed - Railway provides DATABASE_URL via environment variables
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { googleAuthRoutes } from './routes/auth';

const fastify = Fastify({
  logger: true,
});

// Register plugins
fastify.register(cors, {
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});

fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'your-secret-key-here',
});

// Health check
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
fastify.register(googleAuthRoutes);

// Import and register new routes
import { jobRoutes } from './routes/jobs';
import { applicationRoutes } from './routes/applications';
import { dashboardRoutes, userRoutes } from './routes/user';
import { resumeRoutes, subscriptionRoutes } from './routes/resume';

fastify.register(jobRoutes);
fastify.register(applicationRoutes);
fastify.register(dashboardRoutes);
fastify.register(userRoutes);
fastify.register(resumeRoutes);
fastify.register(subscriptionRoutes);

// Database initialization
import { pool } from './lib/db';

const initDatabase = async () => {
  try {
    const client = await pool.connect();
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "User" (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        "fullName" VARCHAR(255),
        "passwordHash" VARCHAR(255),
        "referralCode" VARCHAR(50),
        "emailVerified" BOOLEAN DEFAULT false,
        "subscriptionType" VARCHAR(50) DEFAULT 'free',
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Job" (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        company VARCHAR(255),
        location VARCHAR(255),
        description TEXT,
        url VARCHAR(1000),
        salary VARCHAR(100),
        type VARCHAR(50),
        "postedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Application" (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER REFERENCES "User"(id),
        "jobId" INTEGER REFERENCES "Job"(id),
        status VARCHAR(50) DEFAULT 'pending',
        "appliedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "UserProfile" (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER UNIQUE REFERENCES "User"(id),
        bio TEXT,
        skills TEXT,
        experience TEXT,
        education TEXT
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Subscription" (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER REFERENCES "User"(id),
        plan VARCHAR(50),
        status VARCHAR(50),
        "startDate" TIMESTAMP,
        "endDate" TIMESTAMP
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Notification" (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER REFERENCES "User"(id),
        message TEXT,
        read BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    client.release();
    console.log('✅ Database tables created/verified');
  } catch (err) {
    console.error('❌ Database init error:', err);
  }
};

// Seed jobs if empty
const seedJobs = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT COUNT(*) FROM "Job"');
    if (parseInt(result.rows[0].count) === 0) {
      console.log('📦 Seeding 50 jobs...');
      const jobs = [];
      const companies = ['Google', 'Microsoft', 'Meta', 'Apple', 'Amazon', 'Netflix', 'Spotify', 'Stripe', 'Shopify', 'Airbnb', 'Uber', 'Grab', 'Gojek', 'Tokopedia', 'Shopee', 'Traveloka', 'Dana', 'OVO', 'LinkAja', 'Bank Central Asia', 'Bank Mandiri', 'Telkom', 'Indosat', 'XL Axiata', 'Indofood', 'Unilever', 'Nestle', 'Samsung', 'Xiaomi', 'Huawei'];
      const titles = ['Software Engineer', 'Full Stack Developer', 'Frontend Developer', 'Backend Developer', 'DevOps Engineer', 'Data Engineer', 'ML Engineer', 'Product Manager', 'UI/UX Designer', 'Mobile Developer'];
      const locations = ['Jakarta', 'Surabaya', 'Bandung', 'Singapore', 'Remote', 'Tokyo', 'New York', 'London'];
      for (let i = 1; i <= 50; i++) {
        jobs.push(`('${titles[i % titles.length]} ${Math.floor(i/10) + 1}', '${companies[i % companies.length]}', '${locations[i % locations.length]}', 'Exciting role at ${companies[i % companies.length]}', 'https://careers.${companies[i % companies.length].toLowerCase()}.com/job/${i}', '$${(Math.floor(Math.random() * 80) + 40)},000', 'full-time')`);
      }
      await client.query(`INSERT INTO "Job" (title, company, location, description, url, salary, type) VALUES ${jobs.join(', ')}`);
      console.log('✅ 50 jobs seeded!');
    } else {
      console.log(`ℹ️ ${result.rows[0].count} jobs already exist`);
    }
    client.release();
  } catch (err) {
    console.error('❌ Seed error:', err);
  }
};

// Start server
const start = async () => {
  try {
    // Initialize database tables & seed jobs
    await initDatabase();
    await seedJobs();
    
    const port = parseInt(process.env.PORT || '3001', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
