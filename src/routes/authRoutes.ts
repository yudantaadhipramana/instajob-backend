import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  getUserById,
  updateUserProfile,
  changeUserPassword,
} from '../services/authService';
import { authenticateJWT } from '../middleware/authMiddleware';

/**
 * Register endpoint
 * POST /api/auth/register
 * Body: { email, password, fullName }
 */
async function registerHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { email, password, fullName } = request.body as {
      email: string;
      password: string;
      fullName: string;
    };

    // Validate input
    if (!email || !password || !fullName) {
      return reply.status(400).send({
        success: false,
        error: 'Email, password, and full name are required',
      });
    }

    if (password.length < 6) {
      return reply.status(400).send({
        success: false,
        error: 'Password must be at least 6 characters',
      });
    }

    // Register user
    const { user, tokens } = await registerUser(email, password, fullName);

    return reply.status(201).send({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        tokens,
      },
    });
  } catch (error: any) {
    const statusCode = error.message.includes('already registered') ? 409 : 400;
    return reply.status(statusCode).send({
      success: false,
      error: error.message || 'Registration failed',
    });
  }
}

/**
 * Login endpoint
 * POST /api/auth/login
 * Body: { email, password }
 */
async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { email, password } = request.body as {
      email: string;
      password: string;
    };

    // Validate input
    if (!email || !password) {
      return reply.status(400).send({
        success: false,
        error: 'Email and password are required',
      });
    }

    // Login user
    const { user, tokens } = await loginUser(email, password);

    return reply.status(200).send({
      success: true,
      message: 'Login successful',
      data: {
        user,
        tokens,
      },
    });
  } catch (error: any) {
    return reply.status(401).send({
      success: false,
      error: error.message || 'Login failed',
    });
  }
}

/**
 * Refresh token endpoint
 * POST /api/auth/refresh
 * Body: { refreshToken }
 */
async function refreshHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { refreshToken } = request.body as { refreshToken: string };

    if (!refreshToken) {
      return reply.status(400).send({
        success: false,
        error: 'Refresh token is required',
      });
    }

    // Refresh access token
    const tokens = await refreshAccessToken(refreshToken);

    return reply.status(200).send({
      success: true,
      message: 'Token refreshed successfully',
      data: { tokens },
    });
  } catch (error: any) {
    return reply.status(401).send({
      success: false,
      error: error.message || 'Token refresh failed',
    });
  }
}

/**
 * Get current user profile
 * GET /api/auth/profile
 * Headers: Authorization: Bearer <token>
 */
async function getProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized',
      });
    }

    // Get user by ID
    const user = await getUserById(request.user.id);

    return reply.status(200).send({
      success: true,
      data: { user },
    });
  } catch (error: any) {
    return reply.status(400).send({
      success: false,
      error: error.message || 'Failed to fetch profile',
    });
  }
}

/**
 * Update user profile
 * PUT /api/auth/profile
 * Headers: Authorization: Bearer <token>
 * Body: { fullName?, bio?, location?, skills?, experience?, education? }
 */
async function updateProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized',
      });
    }

    const data = request.body as {
      fullName?: string;
      bio?: string;
      location?: string;
      skills?: string[];
      experience?: string;
      education?: string;
    };

    // Update profile
    const user = await updateUserProfile(request.user.id, data);

    return reply.status(200).send({
      success: true,
      message: 'Profile updated successfully',
      data: { user },
    });
  } catch (error: any) {
    return reply.status(400).send({
      success: false,
      error: error.message || 'Failed to update profile',
    });
  }
}

/**
 * Change password
 * POST /api/auth/change-password
 * Headers: Authorization: Bearer <token>
 * Body: { oldPassword, newPassword }
 */
async function changePasswordHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized',
      });
    }

    const { oldPassword, newPassword } = request.body as {
      oldPassword: string;
      newPassword: string;
    };

    if (!oldPassword || !newPassword) {
      return reply.status(400).send({
        success: false,
        error: 'Old and new passwords are required',
      });
    }

    if (newPassword.length < 6) {
      return reply.status(400).send({
        success: false,
        error: 'New password must be at least 6 characters',
      });
    }

    // Change password
    await changeUserPassword(request.user.id, oldPassword, newPassword);

    return reply.status(200).send({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error: any) {
    const statusCode = error.message.includes('incorrect') ? 401 : 400;
    return reply.status(statusCode).send({
      success: false,
      error: error.message || 'Failed to change password',
    });
  }
}

/**
 * Register all auth routes
 */
export async function registerAuthRoutes(fastify: FastifyInstance) {
  // Public routes
  fastify.post('/api/auth/register', registerHandler);
  fastify.post('/api/auth/login', loginHandler);
  fastify.post('/api/auth/refresh', refreshHandler);

  // Protected routes
  fastify.get('/api/auth/profile', { preHandler: authenticateJWT }, getProfileHandler);
  fastify.put('/api/auth/profile', { preHandler: authenticateJWT }, updateProfileHandler);
  fastify.post('/api/auth/change-password', { preHandler: authenticateJWT }, changePasswordHandler);
}
