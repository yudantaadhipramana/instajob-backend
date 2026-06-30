import { FastifyInstance } from 'fastify';
import * as crypto from 'crypto';

const prisma = (global as any).prisma;

export async function tokenManagementRoutes(fastify: FastifyInstance) {
  // Middleware: Verify JWT token
  const verifyToken = async (request: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new Error('Unauthorized');
    }
  };

  // Helper: Generate token hash
  const hashToken = (token: string) => {
    return crypto.createHash('sha256').update(token).digest('hex');
  };

  /**
   * POST /api/tokens/create
   * Create subscription token (7-day JWT)
   * Request: { scopes: ["job_discovery", "bot_control", "analytics"] }
   */
  fastify.post<{ Body: { scopes?: string[] } }>(
    '/api/tokens/create',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { scopes } = request.body;

      const defaultScopes = ['job_discovery', 'bot_control'];
      const tokenScopes = scopes || defaultScopes;

      try {
        // Generate JWT token (7 days)
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const token = jwt.sign(
          { userId, scopes: tokenScopes },
          process.env.JWT_SECRET || 'your-secret-key-here',
          { expiresIn: '7d' }
        );

        const tokenHash = hashToken(token);

        // Store token hash in database
        await prisma.subscriptionToken.create({
          data: {
            userId,
            tokenHash,
            scopes: tokenScopes,
            expiresAt,
          },
        });

        return reply.code(201).send({
          token,
          expiresAt,
          scopes: tokenScopes,
          message: 'Token created successfully. Store it securely!',
        });
      } catch (err: any) {
        console.error('Error creating token:', err);
        return reply.code(500).send({ error: 'Failed to create token', details: err.message });
      }
    }
  );

  /**
   * GET /api/tokens/list
   * List active tokens for user
   * Query: ?page=1&limit=20
   */
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/tokens/list',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const page = parseInt(request.query.page || '1', 10);
      const limit = parseInt(request.query.limit || '20', 10);
      const skip = (page - 1) * limit;

      try {
        const [tokens, total] = await Promise.all([
          prisma.subscriptionToken.findMany({
            where: { userId },
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              scopes: true,
              expiresAt: true,
              isRevoked: true,
              createdAt: true,
              revokedAt: true,
            },
          }),
          prisma.subscriptionToken.count({ where: { userId } }),
        ]);

        return reply.send({
          tokens,
          total,
          page,
          limit,
          hasMore: skip + limit < total,
        });
      } catch (err: any) {
        console.error('Error listing tokens:', err);
        return reply.code(500).send({ error: 'Failed to list tokens', details: err.message });
      }
    }
  );

  /**
   * POST /api/tokens/:tokenId/validate
   * Validate token (check expiry, scope, revoke status)
   * Request: { token }
   */
  fastify.post<{ Params: { tokenId: string }; Body: { token: string } }>(
    '/api/tokens/:tokenId/validate',
    async (request, reply) => {
      const { tokenId } = request.params;
      const { token } = request.body;

      if (!token) {
        return reply.code(400).send({ error: 'token is required' });
      }

      try {
        const tokenHash = hashToken(token);
        const tokenRecord = await prisma.subscriptionToken.findUnique({
          where: { id: tokenId },
        });

        if (!tokenRecord) {
          return reply.code(404).send({ error: 'Token not found' });
        }

        // Check if revoked
        if (tokenRecord.isRevoked) {
          return reply.send({
            valid: false,
            reason: 'Token has been revoked',
          });
        }

        // Check if expired
        if (new Date() > tokenRecord.expiresAt) {
          return reply.send({
            valid: false,
            reason: 'Token has expired',
          });
        }

        // Verify token hash matches
        if (tokenHash !== tokenRecord.tokenHash) {
          return reply.send({
            valid: false,
            reason: 'Token hash mismatch',
          });
        }

        return reply.send({
          valid: true,
          scopes: tokenRecord.scopes,
          expiresAt: tokenRecord.expiresAt,
        });
      } catch (err: any) {
        console.error('Error validating token:', err);
        return reply.code(500).send({ error: 'Failed to validate token', details: err.message });
      }
    }
  );

  /**
   * POST /api/tokens/:tokenId/revoke
   * Revoke token immediately
   */
  fastify.post<{ Params: { tokenId: string } }>(
    '/api/tokens/:tokenId/revoke',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { tokenId } = request.params;

      try {
        const token = await prisma.subscriptionToken.findUnique({
          where: { id: tokenId },
        });

        if (!token || token.userId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        await prisma.subscriptionToken.update({
          where: { id: tokenId },
          data: { isRevoked: true, revokedAt: new Date() },
        });

        return reply.send({
          success: true,
          message: 'Token revoked successfully',
          revokedAt: new Date(),
        });
      } catch (err: any) {
        console.error('Error revoking token:', err);
        return reply.code(500).send({ error: 'Failed to revoke token', details: err.message });
      }
    }
  );

  /**
   * POST /api/tokens/:tokenId/refresh
   * Refresh token (extend 7 days)
   */
  fastify.post<{ Params: { tokenId: string } }>(
    '/api/tokens/:tokenId/refresh',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { tokenId } = request.params;

      try {
        const token = await prisma.subscriptionToken.findUnique({
          where: { id: tokenId },
        });

        if (!token || token.userId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        if (token.isRevoked) {
          return reply.code(400).send({ error: 'Cannot refresh revoked token' });
        }

        // Generate new JWT token (7 days)
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const newToken = jwt.sign(
          { userId, scopes: token.scopes },
          process.env.JWT_SECRET || 'your-secret-key-here',
          { expiresIn: '7d' }
        );

        const newTokenHash = hashToken(newToken);

        // Update token record
        await prisma.subscriptionToken.update({
          where: { id: tokenId },
          data: { tokenHash: newTokenHash, expiresAt },
        });

        return reply.send({
          token: newToken,
          expiresAt,
          scopes: token.scopes,
        });
      } catch (err: any) {
        console.error('Error refreshing token:', err);
        return reply.code(500).send({ error: 'Failed to refresh token', details: err.message });
      }
    }
  );
}

  /**
   * DELETE /api/tokens/:tokenId
   * Delete token record
   */
  fastify.delete<{ Params: { tokenId: string } }>(
    '/api/tokens/:tokenId',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { tokenId } = request.params;

      try {
        const token = await prisma.subscriptionToken.findUnique({
          where: { id: tokenId },
        });

        if (!token || token.userId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        await prisma.subscriptionToken.delete({ where: { id: tokenId } });

        return reply.send({ success: true, message: 'Token deleted successfully' });
      } catch (err: any) {
        console.error('Error deleting token:', err);
        return reply.code(500).send({ error: 'Failed to delete token', details: err.message });
      }
    }
  );
}
