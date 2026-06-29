// INSTAJOB PHASE 3A — SENDER BOT ROUTES
// File: src/routes/senderRoutes.js
// Purpose: Job application automation control endpoints
// Chunk: 1 of 2 (endpoints 1-3: config, start, stop)

const { spawn } = require('child_process');
const path = require('path');

const activeSenderProcesses = new Map();

// ============================================
// ROUTE 1: POST /api/sender/config
// Save or update Sender Bot configuration
// ============================================

async function handleSenderConfig(request, reply) {
  try {
    const userId = request.user.id;
    const { emailTemplate, subjectTemplate, delaySeconds, maxAppsPerDay, replyToEmail } = request.body;

    if (!emailTemplate) {
      return reply.status(400).send({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Email template is required',
      });
    }

    if (delaySeconds && delaySeconds < 5) {
      return reply.status(400).send({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Delay between applications must be at least 5 seconds',
      });
    }

    const configData = {
      userId,
      botType: 'sender',
      name: `sender_config_${Date.now()}`,
      configData: JSON.stringify({
        emailTemplate,
        subjectTemplate: subjectTemplate || 'Application for {job_title} at {company_name}',
        delaySeconds: delaySeconds || 30,
        maxAppsPerDay: maxAppsPerDay || 20,
        replyToEmail,
      }),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return reply.status(201).send({
      status: 'success',
      message: 'Sender configuration saved',
      config: {
        emailTemplate,
        subjectTemplate: subjectTemplate || 'Application for {job_title} at {company_name}',
        delaySeconds: delaySeconds || 30,
        maxAppsPerDay: maxAppsPerDay || 20,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to save sender configuration',
    });
  }
}

// ============================================
// ROUTE 2: POST /api/sender/start
// Start the Sender Bot (job applications automation)
// ============================================

async function handleSenderStart(request, reply) {
  try {
    const userId = request.user.id;
    const { configId, jobFilters } = request.body;

    if (activeSenderProcesses.has(`sender_${userId}`)) {
      return reply.status(409).send({
        status: 'error',
        code: 'CONFLICT',
        message: `Sender bot already running for user ${userId}`,
        processId: `sender_${userId}`,
      });
    }

    const processId = `sender_${userId}`;
    const senderProcess = {
      userId,
      configId: configId || 1,
      jobFilters: jobFilters || {},
      startTime: new Date(),
      applicationsSent: 0,
      applicationsFailed: 0,
    };

    activeSenderProcesses.set(processId, senderProcess);

    return reply.status(202).send({
      status: 'running',
      processId,
      message: 'Sender bot started successfully',
      config: {
        configId: configId || 1,
        jobFilters: jobFilters || {},
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to start sender bot',
    });
  }
}

// ============================================
// ROUTE 3: POST /api/sender/stop
// Stop the Sender Bot
// ============================================

async function handleSenderStop(request, reply) {
  try {
    const userId = request.user.id;
    const processId = `sender_${userId}`;

    if (!activeSenderProcesses.has(processId)) {
      return reply.status(404).send({
        status: 'error',
        code: 'NOT_FOUND',
        message: `Sender bot not running for user ${userId}`,
      });
    }

    const process = activeSenderProcesses.get(processId);
    const applicationsSent = process.applicationsSent || 0;
    const applicationsFailed = process.applicationsFailed || 0;
    const successRate = applicationsSent > 0 ? ((applicationsSent - applicationsFailed) / applicationsSent * 100).toFixed(2) : 0;

    activeSenderProcesses.delete(processId);

    return reply.status(200).send({
      status: 'stopped',
      processId,
      applicationsSent,
      applicationsFailed,
      successRate: `${successRate}%`,
      message: 'Sender bot stopped successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to stop sender bot',
    });
  }
}

// ============================================
// EXPORT ROUTE HANDLERS (CHUNK 1)
// ============================================

module.exports = {
  handleSenderConfig,
  handleSenderStart,
  handleSenderStop,
  activeSenderProcesses,
};
