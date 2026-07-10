import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

/**
 * Scout Engine bot profile + analytics tracking.
 * NOTE: Does NOT duplicate the existing /api/bot/start|pause|resume|stop|status
 * endpoints (src/index.ts) which drive AutoApplyRun + BotStatus + AutoApplyQueue —
 * that is the production auto-apply run controller (Phase F/H) and must stay untouched.
 * This file only adds NEW tracking surfaces for BotProfile/JobBatch/BotAnalytics
 * (Phase 3A corrected architecture — Scout Engine metadata, not run control).
 */
export async function botControlRoutes(fastify: any) {
  // GET /api/bot/profile - Get or create user's Scout bot profile
  fastify.get('/api/bot/profile',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;

        let profile = await prisma.botProfile.findUnique({
          where: { userId }
        });

        if (!profile) {
          profile = await prisma.botProfile.create({
            data: {
              userId,
              botName: 'My Job Scout',
              status: 'IDLE'
            }
          });
        }

        reply.send(profile);
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // GET /api/bot/analytics - Get bot analytics (last 30 days)
  fastify.get('/api/bot/analytics',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const analytics = await prisma.botAnalytics.findMany({
          where: {
            userId,
            date: { gte: thirtyDaysAgo }
          },
          orderBy: { date: 'desc' }
        });

        const summary = analytics.reduce((acc, curr) => ({
          totalApplied: acc.totalApplied + curr.appliedCount,
          totalSuccess: acc.totalSuccess + curr.successCount,
          totalFailure: acc.totalFailure + curr.failureCount
        }), { totalApplied: 0, totalSuccess: 0, totalFailure: 0 });

        reply.send({ summary, daily: analytics });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // GET /api/bot/batches - Get recent job batches
  fastify.get('/api/bot/batches',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;

        const batches = await prisma.jobBatch.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20
        });

        reply.send({ batches });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // POST /api/bot/batch - Create new job batch
  fastify.post('/api/bot/batch',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const schema = z.object({ jobIds: z.array(z.string()).min(1) });
        const { jobIds } = schema.parse(req.body);

        const batch = await prisma.jobBatch.create({
          data: {
            userId,
            jobIds: JSON.stringify(jobIds),
            status: 'PENDING'
          }
        });

        reply.send({ success: true, batch });
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // PATCH /api/bot/batch/:id - Update batch status
  fastify.patch('/api/bot/batch/:id',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const { id } = req.params;

        const schema = z.object({
          status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
          successCount: z.number().optional(),
          failureCount: z.number().optional()
        });

        const updates = schema.parse(req.body);

        const result = await prisma.jobBatch.updateMany({
          where: { id, userId },
          data: updates
        });

        if (result.count === 0) {
          return reply.status(404).send({ error: 'Batch not found' });
        }

        reply.send({ success: true });
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );
}
