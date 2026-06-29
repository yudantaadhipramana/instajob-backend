const { verifyAccessToken } = require('../services/authService');

/**
 * JWT Authentication Middleware
 * Verifies access token from Authorization header
 */
async function authenticateJWT(request, reply) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: 'Missing or invalid authorization header',
      });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify token
    const decoded = verifyAccessToken(token);
    if (!decoded) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid or expired access token',
      });
    }

    // Attach user to request
    request.user = decoded;
  } catch (error) {
    return reply.status(401).send({
      success: false,
      error: 'Token verification failed',
    });
  }
}

/**
 * Optional JWT Middleware
 * Does not require token, but verifies if provided
 */
async function optionalAuthJWT(request, reply) {
  try {
    const authHeader = request.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyAccessToken(token);
      if (decoded) {
        request.user = decoded;
      }
    }
  } catch (error) {
    // Silently fail for optional auth
  }
}

/**
 * Error handling middleware
 */
async function errorHandler(error, request, reply) {
  console.error('[ERROR]', {
    message: error.message,
    statusCode: error.statusCode,
    path: request.url,
    method: request.method,
    timestamp: new Date().toISOString(),
  });

  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal server error';

  return reply.status(statusCode).send({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
}

/**
 * Request logging middleware
 */
async function requestLogger(request, reply) {
  const start = Date.now();

  reply.addHook('onResponse', (request, reply, done) => {
    const duration = Date.now() - start;
    console.log(`[${request.method}] ${request.url} - ${reply.statusCode} (${duration}ms)`);
    done();
  });
}

/**
 * CORS configuration
 */
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Export functions
module.exports = {
  authenticateJWT,
  optionalAuthJWT,
  errorHandler,
  requestLogger,
  corsOptions,
};
