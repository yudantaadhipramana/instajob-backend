import { FastifyInstance } from 'fastify';

const prisma = (global as any).prisma;

export async function analyticsRoutes(fastify: FastifyInstance) {
  // Middleware: Verify JWT token
  const verifyToken = async (request: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new Error('Unauthorized');
    }
  };

  /**
   * GET /api/analytics/dashboard
   * Get user analytics dashboard summary
   */
  fastify.get(
    '/api/analytics/dashboard',
    async (request: any, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;

      try {
        // Fetch user's bots
        const bots = await prisma.botProfile.findMany({
          where: { ownerUserId: userId },
          select: { id: true, botName: true, botStatus: true },
        });

        // Fetch fleets count
        const fleetCount = await prisma.botFleet.count({
          where: { ownerUserId: userId },
        });

        // Fetch active tokens count
        const tokenCount = await prisma.subscriptionToken.count({
          where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
        });

        // Fetch job batches
        const batchStats = await prisma.jobBatch.groupBy({
          by: ['status'],
          where: { userId },
          _count: true,
        });

        // Aggregate analytics from all bots
        const allAnalytics = await prisma.botAnalytics.findMany({
          where: { bot: { ownerUserId: userId } },
          orderBy: { date: 'desc' },
          take: 30,
        });

        const totalJobsDiscovered = allAnalytics.reduce((sum, a) => sum + a.jobsDiscovered, 0);
        const totalJobsApplied = allAnalytics.reduce((sum, a) => sum + a.jobsApplied, 0);
        const avgSuccessRate =
          allAnalytics.length > 0
            ? allAnalytics.reduce((sum, a) => sum + a.successRate, 0) / allAnalytics.length
            : 0;

        const batchCounts = {
          pending: batchStats.find((b) => b.status === 'PENDING')?._count || 0,
          processing: batchStats.find((b) => b.status === 'PROCESSING')?._count || 0,
          completed: batchStats.find((b) => b.status === 'COMPLETED')?._count || 0,
          failed: batchStats.find((b) => b.status === 'FAILED')?._count || 0,
        };

        return reply.send({
          bots: {
            total: bots.length,
            active: bots.filter((b) => b.botStatus === 'ACTIVE').length,
            inactive: bots.filter((b) => b.botStatus === 'INACTIVE').length,
            suspended: bots.filter((b) => b.botStatus === 'SUSPENDED').length,
          },
          fleets: fleetCount,
          tokens: {
            active: tokenCount,
          },
          batches: batchCounts,
          metrics: {
            totalJobsDiscovered,
            totalJobsApplied,
            avgSuccessRate: (avgSuccessRate * 100).toFixed(2) + '%',
            period: '30 days',
          },
        });
      } catch (err: any) {
        console.error('Error fetching dashboard:', err);
        return reply.code(500).send({
          error: 'Failed to fetch dashboard',
          details: err.message,
        });
      }
    }
  );

  /**
   * GET /api/analytics/bot/:botId/report
   * Get detailed bot analytics report
   * Query: ?days=30
   */
  fastify.get<{
    Params: { botId: string };
    Querystring: { days?: string };
  }>(
    '/api/analytics/bot/:botId/report',
    async (request: any, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { botId } = request.params;
      const days = parseInt(request.query.days || '30', 10);

      try {
        // Verify bot ownership
        const bot = await prisma.botProfile.findUnique({
          where: { id: botId },
        });

        if (!bot || bot.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        // Fetch analytics for bot
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const analytics = await prisma.botAnalytics.findMany({
          where: {
            botId,
            date: { gte: startDate },
          },
          orderBy: { date: 'asc' },
        });

        // Calculate metrics
        const totalJobsDiscovered = analytics.reduce((sum, a) => a.jobsDiscovered + sum, 0);
        const totalJobsApplied = analytics.reduce((sum, a) => a.jobsApplied + sum, 0);
        const avgSuccessRate =
          analytics.length > 0
            ? (analytics.reduce((sum, a) => a.successRate + sum, 0) / analytics.length * 100).toFixed(2)
            : '0.00';
        const avgTimePerJob =
          analytics.length > 0
            ? (analytics.reduce((sum, a) => a.averageTimePerJob + sum, 0) / analytics.length).toFixed(0)
            : 0;

        // Fetch recent batches
        const recentBatches = await prisma.jobBatch.findMany({
          where: { botId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        return reply.send({
          bot: {
            id: bot.id,
            name: bot.botName,
            status: bot.botStatus,
          },
          period: `Last ${days} days`,
          metrics: {
            totalJobsDiscovered,
            totalJobsApplied,
            conversionRate: totalJobsDiscovered > 0
              ? ((totalJobsApplied / totalJobsDiscovered) * 100).toFixed(2) + '%'
              : '0%',
            avgSuccessRate: avgSuccessRate + '%',
            avgTimePerJob: avgTimePerJob + 'ms',
          },
          timeline: analytics,
          recentBatches: recentBatches.map((b) => ({
            id: b.id,
            jobCount: b.jobIds.length,
            status: b.status,
            createdAt: b.createdAt,
          })),
        });
      } catch (err: any) {
        console.error('Error generating report:', err);
        return reply.code(500).send({
          error: 'Failed to generate report',
          details: err.message,
        });
      }
    }
  );
}

  /**
   * POST /api/analytics/export
   * Export analytics data (CSV format)
   * Request: { format: "csv" | "json", botId?, days? }
   */
  fastify.post<{
    Body: { format?: string; botId?: string; days?: number };
  }>(
    '/api/analytics/export',
    async (request: any, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { format = 'json', botId, days = 30 } = request.body;

      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Build query
        const where = botId
          ? { bot: { ownerUserId: userId, id: botId }, date: { gte: startDate } }
          : { bot: { ownerUserId: userId }, date: { gte: startDate } };

        const analytics = await prisma.botAnalytics.findMany({
          where,
          orderBy: { date: 'desc' },
          include: { bot: { select: { botName: true } } },
        });

        if (format === 'csv') {
          // Generate CSV
          const csv = [
            'Date,Bot Name,Jobs Discovered,Jobs Applied,Success Rate,Avg Time Per Job',
            ...analytics.map(
              (a) =>
                `${a.date.toISOString()},${a.bot.botName},${a.jobsDiscovered},${a.jobsApplied},${(a.successRate * 100).toFixed(2)}%,${a.averageTimePerJob}ms`
            ),
          ].join('\n');

          return reply
            .header('Content-Type', 'text/csv')
            .header('Content-Disposition', 'attachment; filename="analytics.csv"')
            .send(csv);
        } else {
          // JSON format
          return reply.send({
            format: 'json',
            exportDate: new Date(),
            period: `Last ${days} days`,
            dataPoints: analytics.length,
            data: analytics,
          });
        }
      } catch (err: any) {
        console.error('Error exporting analytics:', err);
        return reply.code(500).send({
          error: 'Failed to export analytics',
          details: err.message,
        });
      }
    }
  );
}
