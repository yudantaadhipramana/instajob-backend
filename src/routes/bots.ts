import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const prisma = (global as any).prisma;

export async function botManagementRoutes(fastify: FastifyInstance) {
  // Middleware: Verify JWT token
  const verifyToken = async (request: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new Error('Unauthorized');
    }
  };

  /**
   * POST /api/bots/create
   * Create new bot profile
   * Request: { botName, telegramBotToken? }
   */
  fastify.post<{ Body: { botName: string; telegramBotToken?: string } }>(
    '/api/bots/create',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { botName, telegramBotToken } = request.body;

      if (!botName) {
        return reply.code(400).send({ error: 'botName is required' });
      }

      try {
        const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const bot = await prisma.botProfile.create({
          data: {
            botId,
            botName,
            telegramBotToken: telegramBotToken || null,
            botStatus: 'ACTIVE',
            ownerUserId: userId,
          },
        });

        return reply.code(201).send({
          botId: bot.id,
          botName: bot.botName,
          botStatus: bot.botStatus,
          createdAt: bot.createdAt,
        });
      } catch (err: any) {
        console.error('Error creating bot:', err);
        return reply.code(500).send({ error: 'Failed to create bot', details: err.message });
      }
    }
  );

  /**
   * GET /api/bots/list
   * List all bots for authenticated user
   * Query: ?page=1&limit=20
   */
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/bots/list',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const page = parseInt(request.query.page || '1', 10);
      const limit = parseInt(request.query.limit || '20', 10);
      const skip = (page - 1) * limit;

      try {
        const [bots, total] = await Promise.all([
          prisma.botProfile.findMany({
            where: { ownerUserId: userId },
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: { analytics: { take: 1, orderBy: { date: 'desc' } } },
          }),
          prisma.botProfile.count({ where: { ownerUserId: userId } }),
        ]);

        return reply.send({
          bots,
          total,
          page,
          limit,
          hasMore: skip + limit < total,
        });
      } catch (err: any) {
        console.error('Error listing bots:', err);
        return reply.code(500).send({ error: 'Failed to list bots', details: err.message });
      }
    }
  );

  /**
   * GET /api/bots/:botId
   * Get bot profile details
   */
  fastify.get<{ Params: { botId: string } }>(
    '/api/bots/:botId',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { botId } = request.params;

      try {
        const bot = await prisma.botProfile.findUnique({
          where: { id: botId },
          include: {
            fleet: true,
            analytics: { take: 7, orderBy: { date: 'desc' } },
            batches: { take: 10, orderBy: { createdAt: 'desc' } },
          },
        });

        if (!bot) {
          return reply.code(404).send({ error: 'Bot not found' });
        }

        if (bot.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        return reply.send(bot);
      } catch (err: any) {
        console.error('Error getting bot details:', err);
        return reply.code(500).send({ error: 'Failed to get bot details', details: err.message });
      }
    }
  );

  /**
   * PATCH /api/bots/:botId/update
   * Update bot profile
   * Request: { botName?, botStatus? }
   */
  fastify.patch<{
    Params: { botId: string };
    Body: { botName?: string; botStatus?: string };
  }>(
    '/api/bots/:botId/update',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { botId } = request.params;
      const { botName, botStatus } = request.body;

      try {
        // Verify ownership
        const bot = await prisma.botProfile.findUnique({ where: { id: botId } });
        if (!bot || bot.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        const updated = await prisma.botProfile.update({
          where: { id: botId },
          data: {
            ...(botName && { botName }),
            ...(botStatus && { botStatus }),
          },
        });

        return reply.send(updated);
      } catch (err: any) {
        console.error('Error updating bot:', err);
        return reply.code(500).send({ error: 'Failed to update bot', details: err.message });
      }
    }
  );

  /**
   * DELETE /api/bots/:botId
   * Delete bot (soft delete, mark SUSPENDED)
   */
  fastify.delete<{ Params: { botId: string } }>(
    '/api/bots/:botId',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { botId } = request.params;

      try {
        const bot = await prisma.botProfile.findUnique({ where: { id: botId } });
        if (!bot || bot.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        await prisma.botProfile.update({
          where: { id: botId },
          data: { botStatus: 'SUSPENDED' },
        });

        return reply.send({ success: true, message: 'Bot suspended successfully' });
      } catch (err: any) {
        console.error('Error deleting bot:', err);
        return reply.code(500).send({ error: 'Failed to delete bot', details: err.message });
      }
    }
  );

  /**
   * POST /api/bots/:botId/heartbeat
   * Record bot heartbeat
   * Request: { timestamp }
   */
  fastify.post<{ Params: { botId: string }; Body: { timestamp?: number } }>(
    '/api/bots/:botId/heartbeat',
    async (request, reply) => {
      const { botId } = request.params;
      const { timestamp } = request.body;

      try {
        const bot = await prisma.botProfile.findUnique({ where: { id: botId } });
        if (!bot) {
          return reply.code(404).send({ error: 'Bot not found' });
        }

        await prisma.botProfile.update({
          where: { id: botId },
          data: { lastHeartbeat: new Date() },
        });

        return reply.send({
          status: 'ok',
          nextCheckIn: new Date(Date.now() + 60000).toISOString(),
        });
      } catch (err: any) {
        console.error('Error recording heartbeat:', err);
        return reply.code(500).send({ error: 'Failed to record heartbeat', details: err.message });
      }
    }
  );
}
