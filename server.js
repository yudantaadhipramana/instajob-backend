require('dotenv/config');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const { PrismaClient } = require('@prisma/client');

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

const start = async () => {
  try {
    // CORS setup
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    await fastify.register(cors, {
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    // Security headers
    fastify.addHook('onSend', async (_req, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('X-XSS-Protection', '1; mode=block');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    });

    // JWT Plugin
    await fastify.register(jwt, {
      secret: process.env.JWT_SECRET || 'instajob-secret-key-2026-change-in-production'
    });

    // Health check endpoint
    fastify.get('/api/health', async (request, reply) => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Test endpoint
    fastify.get('/api/test', async (request, reply) => {
      return { message: 'InstaJob Backend is running!', time: new Date().toISOString() };
    });

    // Get all jobs
    fastify.get('/api/jobs', async (request, reply) => {
      try {
        const jobs = await prisma.job.findMany({
          take: 50,
          orderBy: { createdAt: 'desc' }
        });
        return { success: true, data: jobs };
      } catch (err) {
        reply.code(500);
        return { success: false, error: err.message };
      }
    });

    // Get user profile
    fastify.get('/api/users/:id', async (request, reply) => {
      try {
        const { id } = request.params;
        const user = await prisma.user.findUnique({
          where: { id },
          include: { profile: true }
        });
        if (!user) {
          reply.code(404);
          return { success: false, error: 'User not found' };
        }
        return { success: true, data: user };
      } catch (err) {
        reply.code(500);
        return { success: false, error: err.message };
      }
    });

    // Create test job
    fastify.post('/api/jobs', async (request, reply) => {
      try {
        const { title, company, location, description } = request.body;
        const job = await prisma.job.create({
          data: {
            title: title || 'Senior Developer',
            company: company || 'Tech Company',
            companyName: company || 'Tech Company',
            location: location || 'Remote',
            description: description || 'Great opportunity',
            requiredSkills: JSON.stringify(['JavaScript', 'React', 'Node.js'])
          }
        });
        return { success: true, data: job };
      } catch (err) {
        reply.code(500);
        return { success: false, error: err.message };
      }
    });

    // Start server
    const port = process.env.PORT || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`✓ InstaJob Backend running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
