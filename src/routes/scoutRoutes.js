// INSTAJOB PHASE 3A — SCOUT BOT ROUTES
// File: src/routes/scoutRoutes.js
// Purpose: Job discovery automation control endpoints
// Chunk: 1 of 2 (endpoints 1-3 of 4)

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Store active scout processes
const activeScoutProcesses = new Map();

// ============================================
// ROUTE 1: POST /api/scout/config
// Save or update Scout Bot configuration
// ============================================

async function handleScoutConfig(request, reply) {
  try {
    const userId = request.user.id;
    const { keywords, sources, filters, cvPath, searchFrequency } = request.body;

    // Validate required fields
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return reply.status(400).send({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Invalid configuration: keywords must be non-empty array',
      });
    }

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return reply.status(400).send({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Invalid configuration: sources must be specified (linkedin, indeed, glassdoor)',
      });
    }

    // Validate CV file exists
    if (cvPath && !fs.existsSync(cvPath)) {
      return reply.status(400).send({
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: `CV file not found: ${cvPath}`,
      });
    }

    // Save config to database (mock implementation - real: use Prisma)
    const configData = {
      userId,
      botType: 'scout',
      name: `scout_config_${Date.now()}`,
      configData: JSON.stringify({
        keywords,
        sources,
        filters: filters || {},
        cvPath: cvPath || null,
        searchFrequency: searchFrequency || 3600,
      }),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // TODO: Save to database using Prisma
    // const config = await prisma.botConfig.create({ data: configData });

    return reply.status(201).send({
      status: 'success',
      message: 'Scout configuration saved',
      config: {
        keywords,
        sources,
        filters,
        searchFrequency: searchFrequency || 3600,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to save scout configuration',
    });
  }
}

// ============================================
// ROUTE 2: POST /api/scout/start
// Start the Scout Bot (job discovery automation)
// ============================================

async function handleScoutStart(request, reply) {
  try {
    const userId = request.user.id;
    const { configId, maxJobs, priority } = request.body;

    // Check if scout already running for this user
    if (activeScoutProcesses.has(`scout_${userId}`)) {
      return reply.status(409).send({
        status: 'error',
        code: 'CONFLICT',
        message: `Scout bot already running for user ${userId}`,
        processId: `scout_${userId}`,
      });
    }

    const processId = `scout_${userId}`;

    // TODO: Spawn job_scout_v2.py process with parameters
    // For now: mock implementation
    const scoutProcess = {
      userId,
      configId: configId || 1,
      maxJobs: maxJobs || 100,
      priority: priority || 'balanced',
      startTime: new Date(),
      jobsFound: 0,
      jobsProcessed: 0,
    };

    // Store process reference
    activeScoutProcesses.set(processId, scoutProcess);

    return reply.status(202).send({
      status: 'running',
      processId,
      message: 'Scout bot started successfully',
      config: {
        configId: configId || 1,
        maxJobs: maxJobs || 100,
        priority: priority || 'balanced',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to start scout bot',
    });
  }
}

// ============================================
// ROUTE 3: POST /api/scout/stop
// Stop the Scout Bot
// ============================================

async function handleScoutStop(request, reply) {
  try {
    const userId = request.user.id;
    const processId = `scout_${userId}`;

    // Check if scout is running
    if (!activeScoutProcesses.has(processId)) {
      return reply.status(404).send({
        status: 'error',
        code: 'NOT_FOUND',
        message: `Scout bot not running for user ${userId}`,
      });
    }

    // Get process stats before stopping
    const process = activeScoutProcesses.get(processId);
    const jobsFound = process.jobsFound || 0;
    const jobsProcessed = process.jobsProcessed || 0;

    // Remove from active processes
    activeScoutProcesses.delete(processId);

    // TODO: Kill actual job_scout_v2.py process

    return reply.status(200).send({
      status: 'stopped',
      processId,
      jobsFound,
      jobsProcessed,
      message: 'Scout bot stopped successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to stop scout bot',
    });
  }
}

// ============================================
// ROUTE 4: GET /api/scout/status
// Get current Scout Bot status & metrics
// ============================================

async function handleScoutStatus(request, reply) {
  try {
    const userId = request.user.id;
    const processId = `scout_${userId}`;

    if (!activeScoutProcesses.has(processId)) {
      return reply.status(200).send({
        status: 'stopped',
        processId: null,
        uptime_seconds: 0,
        message: 'Scout bot not running',
        timestamp: new Date().toISOString(),
      });
    }

    const process = activeScoutProcesses.get(processId);
    const uptimeSeconds = Math.floor((Date.now() - process.startTime.getTime()) / 1000);

    return reply.status(200).send({
      status: 'running',
      processId,
      uptime_seconds: uptimeSeconds,
      jobs_found: process.jobsFound || 0,
      jobs_processed: process.jobsProcessed || 0,
      active_searches: process.activeSearches || 0,
      last_update: new Date().toISOString(),
      memory_usage_mb: 125.4,
      cpu_percent: 8.5,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to get scout status',
    });
  }
}

// ============================================
// REGISTER ROUTES IN FASTIFY SERVER
// ============================================

async function registerScoutRoutes(fastify) {
  fastify.post('/api/scout/config', 
    { onRequest: [fastify.authenticate] },
    handleScoutConfig
  );
  fastify.post('/api/scout/start',
    { onRequest: [fastify.authenticate] },
    handleScoutStart
  );
  fastify.post('/api/scout/stop',
    { onRequest: [fastify.authenticate] },
    handleScoutStop
  );
  fastify.get('/api/scout/status',
    { onRequest: [fastify.authenticate] },
    handleScoutStatus
  );
  fastify.log.info('✅ Scout bot routes registered');
}

// ============================================
// EXPORT ROUTE HANDLERS
// ============================================

module.exports = {
  handleScoutConfig,
  handleScoutStart,
  handleScoutStop,
  handleScoutStatus,
  registerScoutRoutes,
};
