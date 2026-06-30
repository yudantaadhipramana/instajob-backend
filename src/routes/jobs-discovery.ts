import { FastifyInstance } from 'fastify';

const prisma = (global as any).prisma;

export async function jobDiscoveryRoutes(fastify: FastifyInstance) {
  // Middleware: Verify JWT token
  const verifyToken = async (request: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new Error('Unauthorized');
    }
  };

  /**
   * POST /api/jobs/discover
   * Discover jobs based on criteria
   * Request: { keywords, locations, salaryMin?, salaryMax?, jobTypes? }
   */
  fastify.post<{
    Body: {
      keywords: string[];
      locations: string[];
      salaryMin?: number;
      salaryMax?: number;
      jobTypes?: string[];
    };
  }>(
    '/api/jobs/discover',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { keywords, locations, salaryMin, salaryMax, jobTypes } = request.body;

      if (!keywords || keywords.length === 0 || !locations || locations.length === 0) {
        return reply.code(400).send({
          error: 'keywords and locations are required',
        });
      }

      try {
        // Mock job discovery (in production, call external job APIs)
        const discoveredJobs = [
          {
            jobId: `job_${Date.now()}_1`,
            title: `${keywords[0]} Developer`,
            company: 'TechCorp',
            location: locations[0],
            salary: `$${salaryMin || 50000} - $${salaryMax || 150000}`,
            jobType: jobTypes?.[0] || 'full-time',
            description: `Looking for ${keywords[0]} developer in ${locations[0]}`,
            postedAt: new Date(),
          },
          {
            jobId: `job_${Date.now()}_2`,
            title: `Senior ${keywords[0]} Engineer`,
            company: 'StartupXYZ',
            location: locations[0],
            salary: `$${salaryMax || 150000}+`,
            jobType: 'full-time',
            description: `Senior role for experienced ${keywords[0]} engineer`,
            postedAt: new Date(),
          },
        ];

        return reply.code(200).send({
          jobsDiscovered: discoveredJobs.length,
          jobs: discoveredJobs,
          filters: { keywords, locations, salaryMin, salaryMax, jobTypes },
        });
      } catch (err: any) {
        console.error('Error discovering jobs:', err);
        return reply.code(500).send({
          error: 'Failed to discover jobs',
          details: err.message,
        });
      }
    }
  );

  /**
   * POST /api/jobs/batch-apply
   * Create batch job application
   * Request: { botId, jobIds }
   */
  fastify.post<{ Body: { botId: string; jobIds: string[] } }>(
    '/api/jobs/batch-apply',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { botId, jobIds } = request.body;

      if (!botId || !jobIds || jobIds.length === 0) {
        return reply.code(400).send({
          error: 'botId and jobIds are required',
        });
      }

      try {
        // Verify bot ownership
        const bot = await prisma.botProfile.findUnique({
          where: { id: botId },
        });

        if (!bot || bot.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        // Create batch record
        const batch = await prisma.jobBatch.create({
          data: {
            botId,
            userId,
            jobIds,
            status: 'PENDING',
          },
        });

        return reply.code(201).send({
          batchId: batch.id,
          botId: batch.botId,
          jobCount: batch.jobIds.length,
          status: batch.status,
          createdAt: batch.createdAt,
        });
      } catch (err: any) {
        console.error('Error creating batch:', err);
        return reply.code(500).send({
          error: 'Failed to create batch',
          details: err.message,
        });
      }
    }
  );

  /**
   * GET /api/jobs/batches/:batchId
   * Get batch details
   */
  fastify.get<{ Params: { batchId: string } }>(
    '/api/jobs/batches/:batchId',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { batchId } = request.params;

      try {
        const batch = await prisma.jobBatch.findUnique({
          where: { id: batchId },
          include: { bot: true },
        });

        if (!batch) {
          return reply.code(404).send({ error: 'Batch not found' });
        }

        if (batch.userId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        return reply.send({
          batchId: batch.id,
          jobIds: batch.jobIds,
          status: batch.status,
          botName: batch.bot.botName,
          createdAt: batch.createdAt,
          completedAt: batch.completedAt,
        });
      } catch (err: any) {
        console.error('Error getting batch:', err);
        return reply.code(500).send({
          error: 'Failed to get batch',
          details: err.message,
        });
      }
    }
  );

  /**
   * GET /api/jobs/batches/bot/:botId
   * List batches for bot
   * Query: ?page=1&limit=20&status=PENDING
   */
  fastify.get<{
    Params: { botId: string };
    Querystring: { page?: string; limit?: string; status?: string };
  }>(
    '/api/jobs/batches/bot/:botId',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { botId } = request.params;
      const page = parseInt(request.query.page || '1', 10);
      const limit = parseInt(request.query.limit || '20', 10);
      const status = request.query.status || undefined;
      const skip = (page - 1) * limit;

      try {
        // Verify bot ownership
        const bot = await prisma.botProfile.findUnique({
          where: { id: botId },
        });

        if (!bot || bot.ownerUserId !== userId) {
          return reply.code(403).send({ error: 'Unauthorized' });
        }

        const [batches, total] = await Promise.all([
          prisma.jobBatch.findMany({
            where: { botId, ...(status && { status }) },
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
          }),
          prisma.jobBatch.count({
            where: { botId, ...(status && { status }) },
          }),
        ]);

        return reply.send({
          batches,
          total,
          page,
          limit,
          hasMore: skip + limit < total,
        });
      } catch (err: any) {
        console.error('Error listing batches:', err);
        return reply.code(500).send({
          error: 'Failed to list batches',
          details: err.message,
        });
      }
    }
  );
}

  /**
   * POST /api/jobs/search
   * Search jobs with advanced filters
   * Request: { query, filters? }
   */
  fastify.post<{ Body: { query: string; filters?: Record<string, any> } }>(
    '/api/jobs/search',
    async (request, reply) => {
      await verifyToken(request);
      const { query, filters } = request.body;

      if (!query) {
        return reply.code(400).send({ error: 'query is required' });
      }

      try {
        // Mock search results
        const searchResults = [
          {
            jobId: `search_${Date.now()}_1`,
            title: query,
            company: 'Company A',
            location: filters?.location || 'Remote',
            relevance: 0.95,
          },
        ];

        return reply.send({
          query,
          resultsCount: searchResults.length,
          results: searchResults,
        });
      } catch (err: any) {
        console.error('Error searching jobs:', err);
        return reply.code(500).send({
          error: 'Failed to search jobs',
          details: err.message,
        });
      }
    }
  );

  /**
   * GET /api/jobs/:jobId/details
   * Get job details
   */
  fastify.get<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId/details',
    async (request, reply) => {
      const { jobId } = request.params;

      try {
        // Mock job details
        const jobDetails = {
          jobId,
          title: 'Software Engineer',
          company: 'TechCorp',
          location: 'San Francisco',
          salary: '$120,000 - $180,000',
          jobType: 'full-time',
          description: 'We are looking for a talented software engineer...',
          requirements: ['React', 'TypeScript', 'Node.js'],
          postedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };

        return reply.send(jobDetails);
      } catch (err: any) {
        console.error('Error getting job details:', err);
        return reply.code(500).send({
          error: 'Failed to get job details',
          details: err.message,
        });
      }
    }
  );

  /**
   * POST /api/jobs/:jobId/save
   * Save job to user's saved jobs
   */
  fastify.post<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId/save',
    async (request, reply) => {
      await verifyToken(request);
      const userId = (request.user as any).id;
      const { jobId } = request.params;

      try {
        // Check if already saved
        const existing = await prisma.savedJob.findUnique({
          where: { userId_jobId: { userId, jobId } },
        });

        if (existing) {
          return reply.code(400).send({
            error: 'Job already saved',
          });
        }

        // Save job
        const saved = await prisma.savedJob.create({
          data: {
            userId,
            jobId,
            jobTitle: 'Software Engineer',
            company: 'TechCorp',
            jobUrl: `https://jobs.example.com/${jobId}`,
          },
        });

        return reply.code(201).send({
          savedJobId: saved.id,
          jobId: saved.jobId,
          savedAt: saved.savedAt,
        });
      } catch (err: any) {
        console.error('Error saving job:', err);
        return reply.code(500).send({
          error: 'Failed to save job',
          details: err.message,
        });
      }
    }
  );
}
