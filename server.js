require('dotenv').config();
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Import routes & middleware
const authRoutes = require('./src/routes/authRoutes');
const { corsOptions, requestLogger, errorHandler } = require('./src/middleware/authMiddleware');

const fastify = Fastify({
  logger: process.env.NODE_ENV === 'development',
});

// Register middleware
fastify.register(cors, corsOptions);
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'your-super-secret-key-change-in-production',
});

// Add request logging
fastify.addHook('onRequest', requestLogger);

// Add error handler
fastify.setErrorHandler(errorHandler);

// Health check endpoint (public)
fastify.get('/api/health', async (request, reply) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    return {
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    };
  } catch (error) {
    return reply.status(503).send({
      success: false,
      status: 'unhealthy',
      error: 'Database connection failed',
    });
  }
});

// Register auth routes
fastify.register(async (fastify) => {
  await authRoutes.registerAuthRoutes(fastify);
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const start = async () => {
  try {
    const port = process.env.PORT || 3001;
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    console.log(`✓ API Server running at http://${host}:${port}`);
    console.log(`✓ Health check: http://${host}:${port}/api/health`);
    console.log(`✓ Auth endpoints: http://${host}:${port}/api/auth/*`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
