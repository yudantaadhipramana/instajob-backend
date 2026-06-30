import { FastifyInstance } from 'fastify';

const prisma = (global as any).prisma;

export async function fleetManagementRoutes(fastify: FastifyInstance) {
  // Middleware: Verify JWT token
  const verifyToken = async (request: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new Error('Unauthorized');
    }
  };

  /**
   * POST /api/fleets/create
   * Create bot fleet
   * Request: { fleetName, description? }
   */
  fastify.post<{ Body: { fleetName: string; description?: string } }>(
    '/api/fleets/create',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { fleetName, description } = request.body;

      if (!fleetName) {
        return reply.code(400).send({ error: 'fleetName is required' });
      }

      try {
        const fleet = await prisma.botFleet.create({
          data: {
            fleetName,
            description: description || null,
            ownerUserId: userId,
          },
        });

        return reply.code(201).send({
          fleetId: fleet.id,
          fleetName: fleet.fleetName,
          description: fleet.description,
          createdAt: fleet.createdAt,
        });
      } catch (err: any) {
        console.error('Error creating fleet:', err);
        return reply.code(500).send({ error: 'Failed to create fleet', details: err.message });
      }
    }
  );

  /**
   * GET /api/fleets/list
   * List all fleets for user
   * Query: ?page=1&limit=20
   */
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/fleets/list',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const page = parseInt(request.query.page || '1', 10);
      const limit = parseInt(request.query.limit || '20', 10);
      const skip = (page - 1) * limit;

      try {
        const [fleets, total] = await Promise.all([
          prisma.botFleet.findMany({
            where: { ownerUserId: userId },
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
              bots: {
                select: { id: true, botName: true, botStatus: true, lastHeartbeat: true },
              },
            },
          }),
          prisma.botFleet.count({ where: { ownerUserId: userId } }),
        ]);

        return reply.send({
          fleets,
          total,
          page,
          limit,
          hasMore: skip + limit < total,
        });
      } catch (err: any) {
        console.error('Error listing fleets:', err);
        return reply.code(500).send({ error: 'Failed to list fleets', details: err.message });
      }
    }
  );

  /**
   * PATCH /api/fleets/:fleetId/update
   * Update fleet info
   * Request: { fleetName?, description? }
   */
  fastify.patch<{
    Params: { fleetId: string };
    Body: { fleetName?: string; description?: string };
  }>(
    '/api/fleets/:fleetId/update',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { fleetId } = request.params;
      const { fleetName, description } = request.body;

      try {
        // Verify ownership
        const fleet = await prisma.botFleet.findUnique({ where: { id: fleetId } });
        if (!fleet || fleet.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        const updated = await prisma.botFleet.update({
          where: { id: fleetId },
          data: {
            ...(fleetName && { fleetName }),
            ...(description !== undefined && { description }),
          },
          include: {
            bots: {
              select: { id: true, botName: true, botStatus: true },
            },
          },
        });

        return reply.send(updated);
      } catch (err: any) {
        console.error('Error updating fleet:', err);
        return reply.code(500).send({ error: 'Failed to update fleet', details: err.message });
      }
    }
  );

  /**
   * POST /api/fleets/:fleetId/add-bot
   * Add bot to fleet
   * Request: { botId }
   */
  fastify.post<{ Params: { fleetId: string }; Body: { botId: string } }>(
    '/api/fleets/:fleetId/add-bot',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { fleetId } = request.params;
      const { botId } = request.body;

      if (!botId) {
        return reply.code(400).send({ error: 'botId is required' });
      }

      try {
        // Verify fleet ownership
        const fleet = await prisma.botFleet.findUnique({ where: { id: fleetId } });
        if (!fleet || fleet.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        // Verify bot ownership
        const bot = await prisma.botProfile.findUnique({ where: { id: botId } });
        if (!bot || bot.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Bot not found or unauthorized' });
        }

        // Add bot to fleet
        await prisma.botProfile.update({
          where: { id: botId },
          data: { fleetId },
        });

        const updated = await prisma.botFleet.findUnique({
          where: { id: fleetId },
          include: {
            bots: {
              select: { id: true, botName: true, botStatus: true },
            },
          },
        });

        return reply.send({
          fleetId: updated!.id,
          botCount: updated!.bots.length,
          bots: updated!.bots,
        });
      } catch (err: any) {
        console.error('Error adding bot to fleet:', err);
        return reply.code(500).send({
          error: 'Failed to add bot to fleet',
          details: err.message,
        });
      }
    }
  );

  /**
   * DELETE /api/fleets/:fleetId/remove-bot
   * Remove bot from fleet
   * Request: { botId }
   */
  fastify.delete<{ Params: { fleetId: string }; Body: { botId: string } }>(
    '/api/fleets/:fleetId/remove-bot',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { fleetId } = request.params;
      const { botId } = request.body;

      if (!botId) {
        return reply.code(400).send({ error: 'botId is required' });
      }

      try {
        // Verify fleet ownership
        const fleet = await prisma.botFleet.findUnique({ where: { id: fleetId } });
        if (!fleet || fleet.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        // Remove bot from fleet
        await prisma.botProfile.update({
          where: { id: botId },
          data: { fleetId: null },
        });

        const updated = await prisma.botFleet.findUnique({
          where: { id: fleetId },
          include: {
            bots: {
              select: { id: true, botName: true, botStatus: true },
            },
          },
        });

        return reply.send({
          fleetId: updated!.id,
          botCount: updated!.bots.length,
          bots: updated!.bots,
        });
      } catch (err: any) {
        console.error('Error removing bot from fleet:', err);
        return reply.code(500).send({
          error: 'Failed to remove bot from fleet',
          details: err.message,
        });
      }
    }
  );
}

  /**
   * DELETE /api/fleets/:fleetId
   * Delete fleet (only if empty)
   */
  fastify.delete<{ Params: { fleetId: string } }>(
    '/api/fleets/:fleetId',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { fleetId } = request.params;

      try {
        // Verify fleet ownership
        const fleet = await prisma.botFleet.findUnique({
          where: { id: fleetId },
          include: { bots: { select: { id: true } } },
        });

        if (!fleet || fleet.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        // Check if fleet is empty
        if (fleet.bots.length > 0) {
          return reply.code(400).send({
            error: 'Fleet is not empty',
            message: 'Remove all bots before deleting fleet',
            botCount: fleet.bots.length,
          });
        }

        // Delete fleet
        await prisma.botFleet.delete({ where: { id: fleetId } });

        return reply.send({ success: true, message: 'Fleet deleted successfully' });
      } catch (err: any) {
        console.error('Error deleting fleet:', err);
        return reply.code(500).send({ error: 'Failed to delete fleet', details: err.message });
      }
    }
  );
}
