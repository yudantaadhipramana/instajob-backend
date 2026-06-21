import 'dotenv/config';
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

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
