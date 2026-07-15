import 'dotenv/config';
import * as Sentry from '@sentry/node';

// Init Sentry before everything else (no-op if SENTRY_DSN unset)
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { authRoutes } from './auth';
import { emailQueue, processEmailQueueSync } from './services/emailQueue';
import { notificationQueue } from './services/notificationQueue';
import { jobScrapingQueue } from './services/jobScrapingQueue';
import { startBot, bot, linkTelegramUser, sendWeeklySummary } from './services/telegramBot';
import { canUserApply, incrementApplyCount, getUserQuota } from './services/rateLimit';
import { calculateMatchScore, getJobRecommendations } from './services/aiService';
import { registerRateLimit, authRateLimit, inputSanitizeHook, authValidationHook, securityHeadersHook } from './middleware/security';
import { integrationsRoutes } from './routes/integrations';
import { botControlRoutes } from './routes/botControl';
import { registerAffiliateRoutes } from './routes/affiliateRoutes';
import { resumeRoutes } from './routes/resume';
const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

const start = async () => {
  try {
    // CORS — allow only known frontend origins (no wildcard)
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,https://instajob-frontend.vercel.app,https://instajob.id,https://www.instajob.id')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    await fastify.register(cors, {
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    // Register multipart for file uploads
    await fastify.register(multipart, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
      },
    });

    // Security headers on every response
    fastify.addHook('onSend', async (_req, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('X-XSS-Protection', '1; mode=block');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    });

    // Global input sanitization on mutation routes
    fastify.addHook('preHandler', async (req, reply) => {
      // Sanitize body on POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object') {
        const sanitize = (obj: any): any => {
          if (!obj || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) return obj.map(sanitize);
          const clean: Record<string, any> = {};
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string') {
              let s = v.replace(/\0/g, '').trim();
              if (s.length > 5000) s = s.slice(0, 5000);
              clean[k] = s;
            } else if (Array.isArray(v)) {
              clean[k] = v.length > 200 ? v.slice(0, 200) : v;
            } else {
              clean[k] = v;
            }
          }
          return clean;
        };
        (req as any).body = sanitize(req.body);
      }
      // Truncate long query strings
      if (req.query && typeof req.query === 'object') {
        for (const [k, v] of Object.entries(req.query as Record<string, any>)) {
          if (typeof v === 'string' && v.length > 1000) {
            (req.query as Record<string, any>)[k] = v.slice(0, 1000);
          }
        }
      }
    });

    // Register JWT
    await fastify.register(jwt, {
      secret: process.env.JWT_SECRET || (() => { if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET env var required in production'); return 'instajob-dev-secret-key-local-only'; })(),
      sign: { expiresIn: '7d' }
    });

    fastify.decorate('authenticate', async function (request: any, reply: any) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.send(err);
      }
    });

    // Global rate limiting (120 req/min)
    await registerRateLimit(fastify);

    // Auth Routes
    await fastify.register(authRoutes);
    await fastify.register(integrationsRoutes);
    await fastify.register(botControlRoutes);
    await registerAffiliateRoutes(fastify);
    await resumeRoutes(fastify);

    // === HEALTH CHECK ===
    await startBot();

    // Start Background Job Workers
    console.log('Starting background job workers...');

    // Schedule: real job scout every 6 hours via Remotive API
    const runJobScout = async () => {
      try {
        const { scoutJobsFromRemotive } = await import('./services/jobScoutService');
        const queries = ['software engineer', 'data scientist', 'product manager', 'devops engineer', 'mobile developer', 'frontend developer', 'backend developer', 'UI UX designer', 'programmer', 'data analyst', 'full stack developer'];
        const results = await Promise.all(queries.map(q => scoutJobsFromRemotive(q, 15)));
        const total = results.reduce((a, b) => a + b, 0);
        console.log(`[JobScout] inserted ${total} new jobs`);
      } catch (err: any) {
        console.error('[JobScout] error:', err.message);
      }
    };

    // Run once at startup + every 6 hours
    runJobScout();
    setInterval(runJobScout, 6 * 60 * 60 * 1000);

    // Weekly summary every Sunday 09:00 (check every hour)
    const runWeeklySummary = async () => {
      const now = new Date();
      if (now.getDay() === 0 && now.getHours() === 9) {
        await sendWeeklySummary().catch(err => console.error('[WeeklySummary]', err.message));
      }
    };
    setInterval(runWeeklySummary, 60 * 60 * 1000);
    console.log('Background workers active');

    // Health Check
    fastify.get('/', async () => {
      return { 
        message: 'Welcome to InstaJob API Gateway',
        version: '1.0.0',
        status: 'online'
      };
    });

    // Register protected routes with onRequest auth check
    fastify.register(async (fastify) => {
      // Add auth verification to all routes in this scope
      // fastify.addHook('onRequest', async (req, reply) => {
      //   try {
      //     await req.jwtVerify();
      //   } catch (err) {
      //     reply.code(401).send({ error: 'Unauthorized' });
      //   }
      // });

      // ========== USER PROFILE ENDPOINTS (PROTECTED) ==========

      // GET /api/users/me - Get current user from token
      fastify.get('/api/users/me', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        // The auth hook already validated the token, so we just return the user payload
        return reply.send(req.user);
      });
      
      // GET /api/user/profile - Get user profile
      fastify.get('/api/user/profile', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { profile: true }
          });

          if (!user) return reply.code(404).send({ error: 'User not found' });

          return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            subscriptionType: user.subscriptionType,
            profile: user.profile || {}
          };
        } catch (err) {
          console.error('Get profile error:', err);
          return reply.code(500).send({ error: 'Failed to fetch profile' });
        }
      });



      // GET /api/user/completeness - Profile completeness score
      fastify.get('/api/user/completeness', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
          const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
          if (!user) return reply.code(404).send({ error: 'User not found' });
          const p = user.profile;
          const checks: Record<string, boolean> = {
            fullName: !!user.fullName,
            bio: !!p?.bio,
            skills: !!p?.skills && p.skills !== '[]',
            experience: !!p?.experience,
            education: !!p?.education,
            location: !!p?.location,
            resumeUrl: !!p?.resumeUrl,
            phone: !!p?.phone,
            jobPreferences: !!p?.jobPreferences && p.jobPreferences !== '{}',
          };
          const score = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
          const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
          return { score, checks, missing };
        } catch (err) {
          return reply.code(500).send({ error: 'Failed to calculate completeness' });
        }
      });

      // PUT /api/user/profile - Update user profile
      fastify.put('/api/user/profile', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        const updateProfileSchema = z.object({
          bio: z.string().optional(),
          skills: z.array(z.string()).optional(),
          experience: z.union([
            z.array(z.object({ title: z.string(), company: z.string(), years: z.number().int().min(0) })),
            z.string(), // backward compat: plain string juga diterima
          ]).optional(),
          education: z.union([
            z.array(z.object({ degree: z.string(), field: z.string() })),
            z.string(), // backward compat
          ]).optional(),
          certifications: z.array(z.object({ name: z.string(), issuer: z.string().optional() })).optional(),
          portfolio: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
          phone: z.string().optional(),
          location: z.string().optional(),
          resumeUrl: z.string().url().optional(),
        });

        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const raw = updateProfileSchema.parse(req.body);
          const data: any = { ...raw };
          if (data.skills) data.skills = JSON.stringify(data.skills);
          if (data.experience && Array.isArray(data.experience)) data.experience = JSON.stringify(data.experience);
          if (data.education && Array.isArray(data.education)) data.education = JSON.stringify(data.education);
          if (data.certifications) data.certifications = JSON.stringify(data.certifications);
          if (data.portfolio) data.portfolio = JSON.stringify(data.portfolio);

          const profile = await prisma.userProfile.upsert({
            where: { userId },
            update: data,
            create: { userId, ...data },
          });

          return reply.code(200).send({
            message: 'Profile updated successfully',
            profile,
          });
        } catch (err: any) {
          if (err instanceof z.ZodError) {
            return reply.code(400).send({ error: 'Invalid input', details: err.issues });
          }
          console.error('Update profile error:', err);
          return reply.code(500).send({ error: 'Failed to update profile' });
        }
      });

      // PUT /api/user/update-name
      fastify.put('/api/user/update-name', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        const updateNameSchema = z.object({
          fullName: z.string().min(1, 'Full name is required').max(100),
        });

        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const { fullName } = updateNameSchema.parse(req.body);

          const user = await prisma.user.update({
            where: { id: userId },
            data: { fullName },
            select: { id: true, email: true, fullName: true },
          });

          return reply.code(200).send({
            message: 'Name updated successfully',
            user,
          });
        } catch (err: any) {
          if (err instanceof z.ZodError) {
            return reply.code(400).send({ error: 'Invalid input', details: err.issues });
          }
          console.error('Update name error:', err);
          return reply.code(500).send({ error: 'Failed to update name' });
        }
      });

      // POST /api/auth/forgot-password — request reset token (no auth)
      fastify.post('/api/auth/forgot-password', async (req: any, reply: any) => {
        try {
          const { email } = req.body as { email: string };
          if (!email) return reply.code(400).send({ error: 'Email required' });
          const user = await prisma.user.findUnique({ where: { email } });
          // Always return 200 to prevent email enumeration
          if (!user) return reply.code(200).send({ message: 'If email exists, reset link sent' });

          // Invalidate old tokens
          await prisma.passwordResetToken.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });

          const crypto = await import('crypto');
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
          await prisma.passwordResetToken.create({ data: { userId: user.id, token, expiresAt } });

          const resetUrl = `${process.env.FRONTEND_URL || 'https://instajob.id'}/reset-password?token=${token}`;

          // Send via Resend HTTP
          if (process.env.RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: process.env.RESEND_FROM || 'InstaJob <onboarding@resend.dev>',
                to: email,
                subject: 'Reset Password InstaJob',
                html: `<p>Klik link berikut untuk reset password Anda (berlaku 1 jam):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
              }),
            });
          } else {
            console.log(`[PasswordReset] Token for ${email}: ${token}`);
          }
          return reply.code(200).send({ message: 'If email exists, reset link sent' });
        } catch (err) {
          console.error('Forgot password error:', err);
          return reply.code(500).send({ error: 'Failed to process request' });
        }
      });

      // POST /api/auth/reset-password — confirm reset
      fastify.post('/api/auth/reset-password', async (req: any, reply: any) => {
        try {
          const { token, newPassword } = req.body as { token: string; newPassword: string };
          if (!token || !newPassword) return reply.code(400).send({ error: 'Token and newPassword required' });
          if (newPassword.length < 6) return reply.code(400).send({ error: 'Password min 6 chars' });

          const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
          if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
            return reply.code(400).send({ error: 'Token invalid or expired' });
          }

          const hash = await bcrypt.hash(newPassword, 10);
          await prisma.$transaction([
            prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash: hash } }),
            prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { used: true } }),
          ]);
          return reply.code(200).send({ message: 'Password reset successful' });
        } catch (err) {
          console.error('Reset password error:', err);
          return reply.code(500).send({ error: 'Failed to reset password' });
        }
      });

      // POST /api/user/change-password
      fastify.post('/api/user/change-password', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        const changePasswordSchema = z.object({
          currentPassword: z.string().min(1, 'Current password is required'),
          newPassword: z.string().min(6, 'New password must be at least 6 characters').max(72),
        });

        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (!user) return reply.code(404).send({ error: 'User not found' });

          const valid = await bcrypt.compare(currentPassword, user.passwordHash);
          if (!valid) return reply.code(400).send({ error: 'Current password is incorrect' });

          const newHash = await bcrypt.hash(newPassword, 10);
          await prisma.user.update({
            where: { id: userId },
            data: { passwordHash: newHash },
          });

          return reply.code(200).send({
            message: 'Password changed successfully',
          });
        } catch (err: any) {
          if (err instanceof z.ZodError) {
            return reply.code(400).send({ error: 'Invalid input', details: err.issues });
          }
          console.error('Change password error:', err);
          return reply.code(500).send({ error: 'Failed to change password' });
        }
      });

      // POST /api/user/upload-profile-picture
      fastify.post('/api/user/upload-profile-picture', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        const uploadPictureSchema = z.object({
          profilePictureUrl: z.string().url('Must be a valid URL'),
        });

        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const { profilePictureUrl } = uploadPictureSchema.parse(req.body);

          const profile = await prisma.userProfile.upsert({
            where: { userId },
            update: { profilePicture: profilePictureUrl },
            create: { userId, profilePicture: profilePictureUrl },
          });

          return reply.code(200).send({
            message: 'Profile picture updated successfully',
            profilePicture: profile.profilePicture,
          });
        } catch (err: any) {
          if (err instanceof z.ZodError) {
            return reply.code(400).send({ error: 'Invalid input', details: err.issues });
          }
          console.error('Upload profile picture error:', err);
          return reply.code(500).send({ error: 'Failed to upload profile picture' });
        }
      });

      // ========== BOT ORCHESTRATION ENDPOINTS (PROTECTED) ==========

      // POST /api/bot/start
      fastify.post('/api/bot/start', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const existingRun = await prisma.autoApplyRun.findFirst({
            where: { userId, status: { in: ['running', 'paused'] } }
          });
          if (existingRun) {
            return reply.code(409).send({ error: 'Bot already running or paused', runId: existingRun.id, status: existingRun.status });
          }

          const profile = await prisma.userProfile.findUnique({ where: { userId } });
          const prefs = profile?.jobPreferences ? JSON.parse(profile.jobPreferences) : {};

          const run = await prisma.autoApplyRun.create({
            data: { userId, status: 'running', snapshotPreference: JSON.stringify(prefs), startedAt: new Date() }
          });

          const jobs = await prisma.job.findMany({
            where: { ...(prefs.remote === true && { remote: true }) },
            take: 50,
            orderBy: { postedAt: 'desc' }
          });

          const queueItems = await Promise.all(
            jobs.map(job => prisma.autoApplyQueue.upsert({
              where: { userId_jobId: { userId, jobId: job.id } },
              create: { userId, jobId: job.id, status: 'pending' },
              update: {}
            }))
          );

          await prisma.botStatus.upsert({
            where: { processId: `run_${run.id}` },
            create: { userId, processId: `run_${run.id}`, botType: 'fleet', status: 'running', jobsProcessed: 0, applicationsSent: 0 },
            update: { status: 'running' }
          });

          return reply.code(201).send({ message: 'Bot started successfully', runId: run.id, status: run.status, jobsQueued: queueItems.length, startedAt: run.startedAt });
        } catch (err: any) {
          console.error('Bot start error:', err);
          return reply.code(500).send({ error: 'Failed to start bot' });
        }
      });

      // POST /api/bot/pause
      fastify.post('/api/bot/pause', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const run = await prisma.autoApplyRun.findFirst({ where: { userId, status: 'running' } });
          if (!run) return reply.code(404).send({ error: 'No running bot found' });

          await prisma.autoApplyRun.update({ where: { id: run.id }, data: { status: 'paused', pausedAt: new Date() } });
          await prisma.botStatus.updateMany({ where: { processId: `run_${run.id}` }, data: { status: 'paused' } });

          return reply.send({ message: 'Bot paused', runId: run.id });
        } catch (err: any) {
          console.error('Bot pause error:', err);
          return reply.code(500).send({ error: 'Failed to pause bot' });
        }
      });

      // POST /api/bot/resume
      fastify.post('/api/bot/resume', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const run = await prisma.autoApplyRun.findFirst({ where: { userId, status: 'paused' } });
          if (!run) return reply.code(404).send({ error: 'No paused bot found' });

          await prisma.autoApplyRun.update({ where: { id: run.id }, data: { status: 'running', pausedAt: null } });
          await prisma.botStatus.updateMany({ where: { processId: `run_${run.id}` }, data: { status: 'running' } });

          return reply.send({ message: 'Bot resumed', runId: run.id });
        } catch (err: any) {
          console.error('Bot resume error:', err);
          return reply.code(500).send({ error: 'Failed to resume bot' });
        }
      });

      // POST /api/bot/stop
      fastify.post('/api/bot/stop', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const run = await prisma.autoApplyRun.findFirst({ where: { userId, status: { in: ['running', 'paused'] } } });
          if (!run) return reply.code(404).send({ error: 'No active bot found' });

          await prisma.autoApplyRun.update({ where: { id: run.id }, data: { status: 'stopped', stoppedAt: new Date() } });
          await prisma.botStatus.updateMany({ where: { processId: `run_${run.id}` }, data: { status: 'stopped' } });
          await prisma.autoApplyQueue.updateMany({ where: { userId, status: 'pending' }, data: { status: 'failed', errorMessage: 'Bot stopped by user' } });

          return reply.send({ message: 'Bot stopped', runId: run.id });
        } catch (err: any) {
          console.error('Bot stop error:', err);
          return reply.code(500).send({ error: 'Failed to stop bot' });
        }
      });

      // GET /api/bot/status
      fastify.get('/api/bot/status', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const run = await prisma.autoApplyRun.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' }
          });

          if (!run) {
            return reply.send({ status: 'idle', runId: null, metrics: { pending: 0, sent: 0, failed: 0 } });
          }

          const botStatus = await prisma.botStatus.findUnique({ where: { processId: `run_${run.id}` } });

          const [pending, sent, failed] = await Promise.all([
            prisma.autoApplyQueue.count({ where: { userId, status: 'pending' } }),
            prisma.autoApplyQueue.count({ where: { userId, status: 'sent' } }),
            prisma.autoApplyQueue.count({ where: { userId, status: 'failed' } })
          ]);

          return reply.send({
            status: run.status,
            runId: run.id,
            startedAt: run.startedAt,
            pausedAt: run.pausedAt,
            stoppedAt: run.stoppedAt,
            metrics: {
              pending,
              sent,
              failed,
              jobsProcessed: botStatus?.jobsProcessed ?? 0,
              applicationsSent: botStatus?.applicationsSent ?? 0
            }
          });
        } catch (err: any) {
          console.error('Bot status error:', err);
          return reply.code(500).send({ error: 'Failed to get bot status' });
        }
      });

      // ========== USER PREFERENCES ENDPOINTS (PROTECTED) ==========

      // GET /api/user/preferences
      fastify.get('/api/user/preferences', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const profile = await prisma.userProfile.findUnique({ where: { userId } });
          const prefs = profile?.jobPreferences ? JSON.parse(profile.jobPreferences) : {};

          return reply.send({
            jobTitles: prefs.jobTitles ?? [],
            locations: prefs.locations ?? [],
            salaryMin: prefs.salaryMin ?? 0,
            salaryMax: prefs.salaryMax ?? 0,
            workTypes: prefs.workTypes ?? [],
            notificationsEnabled: prefs.notificationsEnabled ?? true,
            emailNotifications: prefs.emailNotifications ?? true,
            telegramNotifications: prefs.telegramNotifications ?? false,
            emailTemplate: prefs.emailTemplate ?? '',
          });
        } catch (err) {
          console.error('Get preferences error:', err);
          return reply.code(500).send({ error: 'Failed to fetch preferences' });
        }
      });

      // PUT /api/user/preferences
      fastify.put('/api/user/preferences', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        const prefsSchema = z.object({
          jobTitles: z.array(z.string()).optional(),
          locations: z.array(z.string()).optional(),
          salaryMin: z.number().optional(),
          salaryMax: z.number().optional(),
          workTypes: z.array(z.string()).optional(),
          notificationsEnabled: z.boolean().optional(),
          emailNotifications: z.boolean().optional(),
          telegramNotifications: z.boolean().optional(),
          emailTemplate: z.string().max(2000).optional(),
          website: z.string().optional(),
          linkedIn: z.string().optional(),
          noticePeriod: z.string().optional(),
          remoteOnly: z.boolean().optional(),
          skipAgencies: z.boolean().optional(),
          skipExpMismatch: z.boolean().optional(),
        });

        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const data = prefsSchema.parse(req.body);

          await prisma.userProfile.upsert({
            where: { userId },
            update: { jobPreferences: JSON.stringify(data) },
            create: { userId, jobPreferences: JSON.stringify(data) },
          });

          return reply.code(200).send({ message: 'Preferences updated successfully', preferences: data });
        } catch (err: any) {
          if (err instanceof z.ZodError) {
            return reply.code(400).send({ error: 'Invalid input', details: err.issues });
          }
          console.error('Update preferences error:', err);
          return reply.code(500).send({ error: 'Failed to update preferences' });
        }
      });

      // ========== TELEGRAM ENDPOINTS (PROTECTED) ==========

      // GET /api/telegram/link-status - Check if user has linked Telegram
      fastify.get('/api/telegram/link-status', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId || req.user?.id;
          if (!userId) {
            return reply.code(401).send({ error: 'Unauthorized' });
          }

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isTelegramLinked: true, telegramChatId: true, referralCode: true }
          });

          if (!user) return reply.code(404).send({ error: 'User not found' });

          return {
            isLinked: user.isTelegramLinked,
            referralCode: user.referralCode,
            linkUrl: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME || 'InstaJobBot'}?start=${user.referralCode}`
          };
        } catch (err) {
          console.error('Telegram link status error:', err);
          return reply.code(500).send({ error: 'Failed to fetch link status' });
        }
      });

      // POST /api/telegram/unlink - Unlink Telegram account
      fastify.post('/api/telegram/unlink', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId || req.user?.id;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          await prisma.user.update({
            where: { id: userId },
            data: {
              telegramChatId: null,
              isTelegramLinked: false
            }
          });

          return { message: 'Telegram account unlinked successfully' };
        } catch (err) {
          console.error('Telegram unlink error:', err);
          return reply.code(500).send({ error: 'Failed to unlink Telegram' });
        }
      });

      // POST /api/telegram/test-notification - Send a test notification to Telegram
      fastify.post('/api/telegram/test-notification', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId || req.user?.id;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          await notificationQueue.add('send-notification', {
            userId,
            title: 'Test Notification',
            message: 'Ini adalah notifikasi uji coba dari InstaJob. Bot Telegram Anda sudah terhubung dengan sempurna! 🚀',
            type: 'system'
          });

          return { message: 'Test notification queued successfully' };
        } catch (err) {
          console.error('Test notification error:', err);
          return reply.code(500).send({ error: 'Failed to queue test notification' });
        }
      });

      // ========== EXTENSION ENDPOINTS (PROTECTED) ==========
      fastify.post('/api/extension/sync-apply', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const syncSchema = z.object({
            title: z.string().min(1),
            company: z.string().min(1),
            location: z.string().optional(),
            description: z.string().optional(),
            url: z.string().url().optional(),
            isApplied: z.boolean().optional(),
          });
          const parsed = syncSchema.safeParse(req.body);
          if (!parsed.success) return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
          const { title, company, location, description, url, isApplied } = parsed.data;

          let job = await prisma.job.findFirst({ where: { title, company } });
          if (!job) {
            job = await prisma.job.create({
              data: {
                title,
                company,
                location: location || 'Unknown',
                description: description || 'Scraped from LinkedIn',
                remote: location?.toLowerCase().includes('remote') || false,
              }
            });
          }

          const existingApp = await prisma.application.findUnique({
            where: { userId_jobId: { userId, jobId: job.id } }
          });

          let application;
          if (!existingApp) {
            application = await prisma.application.create({
              data: {
                userId,
                jobId: job.id,
                status: isApplied ? 'applied' : 'pending',
                notes: url ? `LinkedIn URL: ${url}` : null
              }
            });
          } else if (isApplied && existingApp.status === 'pending') {
            application = await prisma.application.update({
              where: { id: existingApp.id },
              data: { status: 'applied' }
            });
          } else {
            application = existingApp;
          }

          return reply.code(200).send({ message: 'Sync successful', job, application });
        } catch (err) {
          console.error('Extension sync error:', err);
          return reply.code(500).send({ error: 'Failed to sync job' });
        }
      });

      // ========== AUTO-APPLY ENDPOINTS (PROTECTED) ==========

      // GET /api/auto-apply/quota - Get user quota status
      fastify.get('/api/auto-apply/quota', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const quota = await getUserQuota(userId);
          return quota;
        } catch (err) {
          console.error('Get quota error:', err);
          return reply.code(500).send({ error: 'Failed to fetch quota' });
        }
      });

      // POST /api/auto-apply/queue - Add job to auto-apply queue
      fastify.post('/api/auto-apply/queue', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const autoApplySchema = z.object({ jobId: z.string().min(1) });
          const aparsed = autoApplySchema.safeParse(req.body);
          if (!aparsed.success) return reply.code(400).send({ error: 'Validation failed', details: aparsed.error.flatten() });
          const { jobId } = aparsed.data;

          // Check profile completeness (min 60% required)
          const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
          const p = user?.profile;
          const checks = [!!user?.fullName, !!p?.bio, !!p?.skills && p.skills !== '[]', !!p?.experience, !!p?.education, !!p?.location, !!p?.resumeUrl, !!p?.phone, !!p?.jobPreferences && p.jobPreferences !== '{}'];
          const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
          if (score < 60) {
            return reply.code(422).send({ error: 'Profil belum lengkap', completenessScore: score, message: `Lengkapi profil minimal 60% sebelum auto-apply (saat ini ${score}%). Buka /preferences untuk melengkapi.` });
          }

          // Check rate limit
          const quotaStatus = await canUserApply(userId);
          if (!quotaStatus.canApply) {
            return reply.code(429).send({
              error: 'Daily limit reached',
              quota: quotaStatus
            });
          }

          // Check if job exists
          const job = await prisma.job.findUnique({ where: { id: jobId } });
          if (!job) return reply.code(404).send({ error: 'Job not found' });

          // Check if already in queue or applied
          const existingQueue = await prisma.autoApplyQueue.findUnique({
            where: { userId_jobId: { userId, jobId } }
          });
          if (existingQueue) {
            return reply.code(409).send({ error: 'Already in queue' });
          }

          const existingApp = await prisma.application.findUnique({
            where: { userId_jobId: { userId, jobId } }
          });
          if (existingApp) {
            return reply.code(409).send({ error: 'Already applied' });
          }

          // Add to queue
          const queueItem = await prisma.autoApplyQueue.create({
            data: { userId, jobId, status: 'pending' }
          });

          // Add to BullMQ for async processing (fire-and-forget with timeout protection)
          try {
            // DEV WORKAROUND: Call sync processor directly to bypass BullMQ connection contention
            // Production: use BullMQ properly with dedicated Redis connection pool
            processEmailQueueSync(userId, jobId).catch((err) => {
              console.warn('processEmailQueueSync error:', err.message);
            });
          } catch (qErr) {
            console.warn('emailQueue unavailable (Redis offline?), skipping BullMQ:', (qErr as any)?.message);
          }

          // Send notification via queue (graceful fallback if Redis offline)
          try {
            await notificationQueue.add('notify', {
              userId,
              title: 'Auto-Apply Queued',
              message: `Your application for ${job.title} at ${job.company} has been queued for auto-apply.`,
              type: 'auto_apply_queued'
            });
          } catch (nErr) {
            console.warn('notificationQueue unavailable (Redis offline?), skipping BullMQ:', (nErr as any)?.message);
          }

          // Increment quota
          await incrementApplyCount(userId);

          return reply.code(201).send({
            message: 'Added to auto-apply queue',
            queueItem
          });
        } catch (err) {
          console.error('Auto-apply queue error:', err);
          return reply.code(500).send({ error: 'Failed to queue application' });
        }
      });

      // GET /api/auto-apply/queue - Get user's queue status
      fastify.get('/api/auto-apply/queue', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const queue = await prisma.autoApplyQueue.findMany({
            where: { userId },
            include: { job: true },
            orderBy: { createdAt: 'desc' }
          });

          const stats = {
            pending: queue.filter(q => q.status === 'pending').length,
            sent: queue.filter(q => q.status === 'sent').length,
            failed: queue.filter(q => q.status === 'failed').length,
            total: queue.length
          };

          return { stats, queue };
        } catch (err) {
          console.error('Get queue error:', err);
          return reply.code(500).send({ error: 'Failed to fetch queue' });
        }
      });

      // ========== NOTIFICATION ENDPOINTS (PROTECTED) ==========

      // GET /api/notifications - Get user's notifications
      fastify.get('/api/notifications', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const notifications = await prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 50
          });

          return { notifications, unread: notifications.filter(n => !n.isRead).length };
        } catch (err) {
          console.error('Get notifications error:', err);
          return reply.code(500).send({ error: 'Failed to fetch notifications' });
        }
      });

      // ========== REFERRAL ENDPOINTS (PROTECTED) ==========

      // GET /api/referral/my-code - Get user's referral code and stats
      fastify.get('/api/referral/my-code', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
              referralCode: true, 
              points: true,
              referrals: { select: { id: true, email: true, createdAt: true } }
            }
          });

          if (!user) return reply.code(404).send({ error: 'User not found' });

          return {
            referralCode: user.referralCode,
            points: user.points,
            referralCount: user.referrals.length,
            referrals: user.referrals
          };
        } catch (err) {
          console.error('Get referral code error:', err);
          return reply.code(500).send({ error: 'Failed to fetch referral code' });
        }
      });

      // POST /api/referral/redeem - Redeem a referral code
      fastify.post('/api/referral/redeem', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const referralSchema = z.object({ referralCode: z.string().min(1) });
          const rparsed = referralSchema.safeParse(req.body);
          if (!rparsed.success) return reply.code(400).send({ error: 'Validation failed', details: rparsed.error.flatten() });
          const { referralCode } = rparsed.data;

          // Check if user already has a referrer
          const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { referredById: true }
          });

          if (currentUser?.referredById) {
            return reply.code(409).send({ error: 'Already referred by another user' });
          }

          // Find referrer by code
          const referrer = await prisma.user.findUnique({
            where: { referralCode }
          });

          if (!referrer) {
            return reply.code(404).send({ error: 'Invalid referral code' });
          }

          if (referrer.id === userId) {
            return reply.code(400).send({ error: 'Cannot refer yourself' });
          }

          // Update user with referrer
          await prisma.user.update({
            where: { id: userId },
            data: { referredById: referrer.id }
          });

          // Give referrer points (50 points per referral)
          await prisma.user.update({
            where: { id: referrer.id },
            data: { points: { increment: 50 } }
          });

          return { 
            message: 'Referral redeemed successfully',
            referredBy: referrer.email,
            pointsAwarded: 50
          };
        } catch (err) {
          console.error('Redeem referral error:', err);
          return reply.code(500).send({ error: 'Failed to redeem referral' });
        }
      });

      // GET /api/referral/leaderboard - Get referral leaderboard
      fastify.get('/api/referral/leaderboard', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const { limit = 10 } = req.query as any;
          const topReferrers = await prisma.user.findMany({
            select: {
              id: true,
              fullName: true,
              email: true,
              points: true,
              referrals: { select: { id: true } }
            },
            orderBy: { points: 'desc' },
            take: parseInt(limit) || 10
          });

          const leaderboard = topReferrers.map((user, idx) => ({
            rank: idx + 1,
            name: user.fullName || user.email,
            points: user.points,
            referralCount: user.referrals.length
          }));

          return leaderboard;
        } catch (err) {
          console.error('Get leaderboard error:', err);
          return reply.code(500).send({ error: 'Failed to fetch leaderboard' });
        }
      });

      // GET /api/referral/rewards - Get available rewards
      fastify.get('/api/referral/rewards', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { points: true, subscriptionType: true }
          });

          if (!user) return reply.code(404).send({ error: 'User not found' });

          const rewards = [
            { id: 1, name: 'Premium 1 Month', cost: 100, description: 'Unlock unlimited applications' },
            { id: 2, name: 'Premium 3 Months', cost: 250, description: 'Unlock unlimited applications' },
            { id: 3, name: 'Resume Review', cost: 50, description: 'Get professional resume feedback' },
            { id: 4, name: 'Cover Letter Boost', cost: 75, description: 'AI-powered cover letter enhancement' }
          ];

          return {
            points: user.points,
            subscriptionType: user.subscriptionType,
            availableRewards: rewards
          };
        } catch (err) {
          console.error('Get rewards error:', err);
          return reply.code(500).send({ error: 'Failed to fetch rewards' });
        }
      });

      // ========== GAMIFICATION ENDPOINTS (PROTECTED) ==========

// ========== BOOKMARK ENDPOINTS (PROTECTED) ==========

// GET /api/bookmarks - Get all bookmarked jobs for a user
fastify.get('/api/bookmarks', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
  try {
    const userId = req.user?.sub || req.user?.userId;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const bookmarks = await prisma.jobBookmark.findMany({
      where: { userId },
      include: { job: true },
      orderBy: { bookmarkedAt: 'desc' },
    });

    return bookmarks.map((b: { job: any }) => b.job);
  } catch (err) {
    console.error('Get bookmarks error:', err);
    return reply.code(500).send({ error: 'Failed to fetch bookmarks' });
  }
});

// POST /api/jobs/:jobId/bookmark - Bookmark a job
fastify.post('/api/jobs/:jobId/bookmark', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
  try {
    const userId = req.user?.sub || req.user?.userId;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const { jobId } = req.params as any;
    if (!jobId) return reply.code(400).send({ error: 'jobId is required' });

    const existingBookmark = await prisma.jobBookmark.findUnique({
      where: { userId_jobId: { userId, jobId } },
    });

    if (existingBookmark) {
      return reply.code(200).send({ message: 'Job already bookmarked' });
    }

    const bookmark = await prisma.jobBookmark.create({
      data: { userId, jobId },
    });

    return reply.code(201).send({ message: 'Job bookmarked successfully', bookmark });
  } catch (err) {
    console.error('Bookmark job error:', err);
    return reply.code(500).send({ error: 'Failed to bookmark job' });
  }
});

// DELETE /api/jobs/:jobId/bookmark - Remove a job bookmark
fastify.delete('/api/jobs/:jobId/bookmark', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
  try {
    const userId = req.user?.sub || req.user?.userId;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const { jobId } = req.params as any;
    if (!jobId) return reply.code(400).send({ error: 'jobId is required' });

    await prisma.jobBookmark.delete({
      where: { userId_jobId: { userId, jobId } },
    });

    return reply.code(200).send({ message: 'Bookmark removed successfully' });
  } catch (err) {
    // If not found, it's a success for the user (idempotent)
    if ((err as any)?.code === 'P2025') {
       return reply.code(200).send({ message: 'Bookmark removed successfully' });
    }
    console.error('Remove bookmark error:', err);
    return reply.code(500).send({ error: 'Failed to remove bookmark' });
  }
});

// ========== PHASE 3A: PAYMENT & TELEGRAM CHAT ENDPOINTS ==========

// GET /api/trx - Get user's payment transactions (protected)
fastify.get('/api/trx', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
  try {
    const userId = req.user?.sub || req.user?.userId;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const transactions = await prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    return transactions;
  } catch (err) {
    console.error('Get transactions error:', err);
    return reply.code(500).send({ error: 'Failed to fetch transactions' });
  }
});

// GET /api/chat - Get user's Telegram chat links (protected)
fastify.get('/api/chat', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
  try {
    const userId = req.user?.sub || req.user?.userId;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const chats = await prisma.telegramChat.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    return chats;
  } catch (err) {
    console.error('Get Telegram chats error:', err);
    return reply.code(500).send({ error: 'Failed to fetch Telegram chats' });
  }
});

      // ========== GAMIFICATION ENDPOINTS (PROTECTED) ==========

      // GET /api/gamification/profile - Get user's gamification profile
      fastify.get('/api/gamification/profile', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              level: true,
              xp: true,
              currentStreak: true,
              longestStreak: true,
              points: true,
              achievements: { orderBy: { earnedAt: 'desc' } }
            }
          });

          if (!user) return reply.code(404).send({ error: 'User not found' });

          // Calculate XP needed for next level (100 XP per level)
          const xpForNextLevel = user.level * 100;
          const progress = (user.xp / xpForNextLevel) * 100;

          return {
            level: user.level,
            xp: user.xp,
            xpForNextLevel,
            progress: Math.min(progress, 100),
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak,
            points: user.points,
            achievements: user.achievements
          };
        } catch (err) {
          console.error('Get gamification profile error:', err);
          return reply.code(500).send({ error: 'Failed to fetch gamification profile' });
        }
      });

      // POST /api/gamification/check-in - Daily check-in to maintain streak
      fastify.post('/api/gamification/check-in', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { lastActiveDate: true, currentStreak: true, longestStreak: true, xp: true, level: true }
          });

          if (!user) return reply.code(404).send({ error: 'User not found' });

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const lastActive = user.lastActiveDate ? new Date(user.lastActiveDate) : null;
          if (lastActive) lastActive.setHours(0, 0, 0, 0);

          let newStreak = user.currentStreak || 0;
          let xpGained = 0;

          // Check if already checked in today
          if (lastActive && lastActive.getTime() === today.getTime()) {
            return reply.code(409).send({ error: 'Already checked in today' });
          }

          // Check if streak continues (last active was yesterday)
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);

          if (lastActive && lastActive.getTime() === yesterday.getTime()) {
            newStreak += 1;
            xpGained = 10 + (newStreak * 2); // Bonus XP for streak
          } else {
            newStreak = 1;
            xpGained = 10;
          }

          const newXp = user.xp + xpGained;
          const newLevel = Math.floor(newXp / 100) + 1;
          const longestStreak = Math.max(newStreak, user.longestStreak || 0);

          await prisma.user.update({
            where: { id: userId },
            data: {
              lastActiveDate: new Date(),
              currentStreak: newStreak,
              longestStreak,
              xp: newXp,
              level: newLevel
            }
          });

          // Award streak milestones
          const milestones = [7, 30, 100];
          for (const milestone of milestones) {
            if (newStreak === milestone) {
              await prisma.achievement.upsert({
                where: { userId_title: { userId, title: `${milestone}-Day Streak` } },
                create: {
                  userId,
                  title: `${milestone}-Day Streak`,
                  description: `Maintained a ${milestone}-day streak!`,
                  icon: '🔥',
                  type: 'streak'
                },
                update: {}
              });
            }
          }

          return {
            message: 'Check-in successful!',
            streak: newStreak,
            xpGained,
            newXp,
            newLevel
          };
        } catch (err) {
          console.error('Check-in error:', err);
          return reply.code(500).send({ error: 'Failed to check in' });
        }
      });

      // GET /api/gamification/achievements - Get all available achievements
      fastify.get('/api/gamification/achievements', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const userAchievements = await prisma.achievement.findMany({
            where: { userId }
          });

          const allAchievements = [
            { title: 'First Application', description: 'Submit your first job application', icon: '🎯', type: 'milestone' },
            { title: '10 Applications', description: 'Submit 10 job applications', icon: '🚀', type: 'milestone' },
            { title: '50 Applications', description: 'Submit 50 job applications', icon: '💪', type: 'milestone' },
            { title: 'First Interview', description: 'Get your first interview', icon: '🎤', type: 'milestone' },
            { title: 'First Offer', description: 'Receive your first job offer', icon: '🎉', type: 'milestone' },
            { title: '7-Day Streak', description: 'Maintain a 7-day login streak', icon: '🔥', type: 'streak' },
            { title: '30-Day Streak', description: 'Maintain a 30-day login streak', icon: '🔥', type: 'streak' },
            { title: 'First Referral', description: 'Refer your first friend', icon: '👥', type: 'badge' },
            { title: '10 Referrals', description: 'Refer 10 friends', icon: '🌟', type: 'badge' }
          ];

          const achievementsWithStatus = allAchievements.map(achievement => ({
            ...achievement,
            earned: userAchievements.some(ua => ua.title === achievement.title),
            earnedAt: userAchievements.find(ua => ua.title === achievement.title)?.earnedAt
          }));

          return achievementsWithStatus;
        } catch (err) {
          console.error('Get achievements error:', err);
          return reply.code(500).send({ error: 'Failed to fetch achievements' });
        }
      });

    }); // End of protected routes scope
    
    // GET /api/jobs - List jobs with pagination and filters
    fastify.get('/api/jobs', async (req: any, reply: any) => {
      try {
        const { page = 1, search, remote, salaryMin, salaryMax, location } = req.query as any;
        const pageNum = parseInt(page) || 1;
        const pageSize = 10;
        const skip = (pageNum - 1) * pageSize;

        const where: any = {};
        
        if (search) {
          where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { company: { contains: search, mode: 'insensitive' } }
          ];
        }

        if (remote !== undefined) {
          where.remote = remote === 'true';
        }

        if (location) {
          where.location = { contains: location, mode: 'insensitive' };
        }

        if (salaryMin || salaryMax) {
          where.AND = [];
          if (salaryMin) {
            where.AND.push({ salaryMin: { gte: parseInt(salaryMin) } });
          }
          if (salaryMax) {
            where.AND.push({ salaryMax: { lte: parseInt(salaryMax) } });
          }
        }

        const [jobs, total] = await Promise.all([
          prisma.job.findMany({
            where,
            take: pageSize,
            skip,
            orderBy: { postedAt: 'desc' }
          }),
          prisma.job.count({ where })
        ]);

        return {
          data: jobs,
          pagination: {
            page: pageNum,
            pageSize,
            total,
            pages: Math.ceil(total / pageSize)
          }
        };
      } catch (err) {
        console.error('Jobs list error:', err);
        return reply.code(500).send({ error: 'Failed to fetch jobs' });
      }
    });

    // POST /api/jobs - Create job (admin/seed)
    fastify.post('/api/jobs', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const { title, company, location, description, remote = false, salaryMin, salaryMax, industry, tags } = req.body as any;
        if (!title || !company) return reply.code(400).send({ error: 'title and company required' });
        const job = await prisma.job.create({ data: { title, company, location, description, remote, salaryMin, salaryMax, industry, tags, postedAt: new Date() } });
        return reply.code(201).send(job);
      } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // GET /api/jobs/locations - distinct locations for dropdown
    fastify.get('/api/jobs/locations', async (_req: any, _reply: any) => {
      const rows = await prisma.job.findMany({ select: { location: true }, distinct: ['location'], orderBy: { location: 'asc' } });
      return rows.map(r => r.location).filter(Boolean);
    });

    // GET /api/jobs/:id - Get job details
    fastify.get('/api/jobs/:id', async (req: any, reply: any) => {
      try {
        const { id } = req.params;

        const job = await prisma.job.findUnique({ where: { id } });

        if (!job) return reply.code(404).send({ error: 'Job not found' });

        return job;
      } catch (err) {
        console.error('Job detail error:', err);
        return reply.code(500).send({ error: 'Failed to fetch job' });
      }
    });

    // ========== APPLICATIONS ENDPOINTS ==========
    
    // POST /api/applications - Create application
    fastify.post('/api/applications', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const appSchema = z.object({ jobId: z.string().min(1), notes: z.string().optional() });
        const appparsed = appSchema.safeParse(req.body);
        if (!appparsed.success) return reply.code(400).send({ error: 'Validation failed', details: appparsed.error.flatten() });
        const { jobId, notes } = appparsed.data;

        // Check if job exists
        const job = await prisma.job.findUnique({ where: { id: jobId } });
        if (!job) return reply.code(404).send({ error: 'Job not found' });

        // Check if already applied
        const existing = await prisma.application.findUnique({
          where: { userId_jobId: { userId, jobId } }
        });
        if (existing) {
          return reply.code(409).send({ error: 'Already applied to this job' });
        }

        const application = await prisma.application.create({
          data: {
            userId,
            jobId,
            status: 'pending',
            notes
          }
        });

        return reply.code(201).send(application);
      } catch (err) {
        console.error('Create application error:', err);
        return reply.code(500).send({ error: 'Failed to create application' });
      }
    });

    // GET /api/applications - List user applications
    fastify.get('/api/applications', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const applications = await prisma.application.findMany({
          where: { userId },
          include: { job: true },
          orderBy: { appliedAt: 'desc' }
        });

        const statusCounts = {
          pending: applications.filter(a => a.status === 'pending').length,
          reviewed: applications.filter(a => a.status === 'reviewed').length,
          interviewed: applications.filter(a => a.status === 'interviewed').length,
          offered: applications.filter(a => a.status === 'offered').length,
          rejected: applications.filter(a => a.status === 'rejected').length
        };

        return {
          total: applications.length,
          statusCounts,
          applications
        };
      } catch (err) {
        console.error('Get applications error:', err);
        return reply.code(500).send({ error: 'Failed to fetch applications' });
      }
    });

    // ========== DASHBOARD STATS ENDPOINT ==========
    
    // GET /api/dashboard/stats - Return dashboard statistics
    fastify.get('/api/dashboard/stats', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
          totalJobs,
          appliedToday,
          saved,
          interviewed,
          offered
        ] = await Promise.all([
          prisma.job.count(),
          prisma.application.count({
            where: { userId, appliedAt: { gte: today } }
          }),
          prisma.application.count({
            where: { userId, status: 'pending' }
          }),
          prisma.application.count({
            where: { userId, status: 'interviewed' }
          }),
          prisma.application.count({
            where: { userId, status: 'offered' }
          })
        ]);

        return {
          totalJobs,
          appliedToday,
          saved,
          interviewed,
          offered,
          timestamp: new Date().toISOString()
        };
      } catch (err) {
        console.error('Dashboard stats error:', err);
        return reply.code(500).send({ error: 'Failed to fetch stats' });
      }
    });

    // ========== ANALYTICS ENDPOINTS ==========
    
    // GET /api/analytics/overview - Get analytics overview
    fastify.get('/api/analytics/overview', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const applications = await prisma.application.findMany({
          where: { userId },
          include: { job: true },
          orderBy: { appliedAt: 'desc' }
        });

        const total = applications.length;
        const applied = applications.filter(a => a.status === 'applied' || a.status === 'reviewed').length;
        const interviewed = applications.filter(a => a.status === 'interviewed').length;
        const offered = applications.filter(a => a.status === 'offered').length;
        const rejected = applications.filter(a => a.status === 'rejected').length;

        const successRate = total > 0 ? ((offered / total) * 100).toFixed(1) : '0';
        const interviewRate = total > 0 ? ((interviewed / total) * 100).toFixed(1) : '0';

        return {
          total,
          applied,
          interviewed,
          offered,
          rejected,
          successRate: parseFloat(successRate),
          interviewRate: parseFloat(interviewRate)
        };
      } catch (err) {
        console.error('Analytics overview error:', err);
        return reply.code(500).send({ error: 'Failed to fetch analytics' });
      }
    });

    // GET /api/analytics/timeline - Get application timeline data
    fastify.get('/api/analytics/timeline', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const { period = '30' } = req.query as any;
        const days = parseInt(period) || 30;
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        const applications = await prisma.application.findMany({
          where: {
            userId,
            appliedAt: { gte: startDate }
          },
          orderBy: { appliedAt: 'asc' }
        });

        // Group by date
        const timeline: Record<string, any> = {};
        applications.forEach(app => {
          const date = app.appliedAt.toISOString().split('T')[0];
          if (!timeline[date]) {
            timeline[date] = { date, applied: 0, interviewed: 0, offered: 0, rejected: 0 };
          }
          if (app.status === 'applied' || app.status === 'reviewed') timeline[date].applied++;
          if (app.status === 'interviewed') timeline[date].interviewed++;
          if (app.status === 'offered') timeline[date].offered++;
          if (app.status === 'rejected') timeline[date].rejected++;
        });

        return Object.values(timeline);
      } catch (err) {
        console.error('Analytics timeline error:', err);
        return reply.code(500).send({ error: 'Failed to fetch timeline' });
      }
    });

    // GET /api/analytics/industries - Get top industries applied
    fastify.get('/api/analytics/industries', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const applications = await prisma.application.findMany({
          where: { userId },
          include: { job: true }
        });

        // Group by company (as proxy for industry)
        const industries: Record<string, number> = {};
        applications.forEach(app => {
          const company = app.job.company || 'Unknown';
          industries[company] = (industries[company] || 0) + 1;
        });

        const sorted = Object.entries(industries)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        return sorted;
      } catch (err) {
        console.error('Analytics industries error:', err);
        return reply.code(500).send({ error: 'Failed to fetch industries' });
      }
    });

    // GET /api/analytics/time-to-hire - Calculate average time to hire
    fastify.get('/api/analytics/time-to-hire', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const applications = await prisma.application.findMany({
          where: {
            userId,
            status: 'offered'
          }
        });

        if (applications.length === 0) {
          return { averageDays: 0, total: 0 };
        }

        let totalDays = 0;
        applications.forEach(app => {
          const days = Math.floor((new Date().getTime() - app.appliedAt.getTime()) / (1000 * 60 * 60 * 24));
          totalDays += days;
        });

        const averageDays = Math.round(totalDays / applications.length);

        return {
          averageDays,
          total: applications.length
        };
      } catch (err) {
        console.error('Time to hire error:', err);
        return reply.code(500).send({ error: 'Failed to calculate time to hire' });
      }
    });

    // ========== SUBSCRIPTION ENDPOINTS (PROTECTED) ==========

    // GET /api/subscription/status - Get current subscription status
    fastify.get('/api/subscription/status', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { 
            subscriptionType: true, 
            email: true,
            fullName: true
          }
        });

        if (!user) return reply.code(404).send({ error: 'User not found' });

        let subscription = await prisma.subscription.findUnique({
          where: { userId }
        });

        if (!subscription) {
          subscription = await prisma.subscription.create({
            data: {
              userId,
              plan: 'free',
              features: JSON.stringify(['basic_search', 'job_bookmarking', 'application_tracking'])
            }
          });
        }

        const isActive = !subscription.expiresAt || new Date(subscription.expiresAt) > new Date();

        return {
          plan: subscription.plan,
          features: subscription.features,
          expiresAt: subscription.expiresAt,
          isActive,
          createdAt: subscription.createdAt
        };
      } catch (err) {
        console.error('Get subscription error:', err);
        return reply.code(500).send({ error: 'Failed to fetch subscription' });
      }
    });

    // POST /api/subscription/upgrade - Upgrade to premium (mock payment)
    fastify.post('/api/subscription/upgrade', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const subSchema = z.object({ plan: z.enum(['pro', 'premium']), months: z.number().int().min(1).max(12).optional() });
        const sparsed = subSchema.safeParse(req.body);
        if (!sparsed.success) return reply.code(400).send({ error: 'Validation failed', details: sparsed.error.flatten() });
        const { plan, months } = sparsed.data;

        const monthsNum = months || 1;

        // Update user subscription type
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionType: plan }
        });

        // Calculate expiry date
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + monthsNum);

        // Update or create subscription
        let subscription = await prisma.subscription.findUnique({ where: { userId } });

        if (!subscription) {
          subscription = await prisma.subscription.create({
            data: {
              userId,
              plan,
              expiresAt,
              features: JSON.stringify(['unlimited_applications', 'ai_matching', 'cover_letter_boost', 'basic_search', 'job_bookmarking', 'application_tracking'])
            }
          });
        } else {
          subscription = await prisma.subscription.update({
            where: { userId },
            data: {
              plan,
              expiresAt,
              features: JSON.stringify(['unlimited_applications', 'ai_matching', 'cover_letter_boost', 'basic_search', 'job_bookmarking', 'application_tracking'])
            }
          });
        }

        return {
          success: true,
          message: `Successfully upgraded to ${plan}`,
          plan: subscription.plan,
          expiresAt: subscription.expiresAt,
          features: subscription.features
        };
      } catch (err) {
        console.error('Upgrade subscription error:', err);
        return reply.code(500).send({ error: 'Failed to upgrade subscription' });
      }
    });

    // POST /api/subscription/cancel - Cancel premium, revert to free
    fastify.post('/api/subscription/cancel', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        // Update user subscription type back to free
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionType: 'free' }
        });

        // Update subscription
        let subscription = await prisma.subscription.findUnique({ where: { userId } });

        if (subscription) {
          subscription = await prisma.subscription.update({
            where: { userId },
            data: {
              plan: 'free',
              expiresAt: null,
              features: JSON.stringify(['basic_search', 'job_bookmarking', 'application_tracking'])
            }
          });
        } else {
          subscription = await prisma.subscription.create({
            data: {
              userId,
              plan: 'free',
              features: JSON.stringify(['basic_search', 'job_bookmarking', 'application_tracking'])
            }
          });
        }

        return {
          success: true,
          message: 'Subscription cancelled, reverted to free plan',
          plan: subscription.plan,
          features: subscription.features
        };
      } catch (err) {
        console.error('Cancel subscription error:', err);
        return reply.code(500).send({ error: 'Failed to cancel subscription' });
      }
    });

    // ========== AI AGENT ENDPOINTS (PROTECTED) ==========

    // GET /api/ai/match-score/:jobId - Calculate match score
    fastify.get('/api/ai/match-score/:jobId', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
        const { jobId } = req.params as any;
        const score = await calculateMatchScore(userId, jobId);
        return { score };
      } catch (err) {
        console.error('AI Match Score error:', err);
        return reply.code(500).send({ error: 'Failed to calculate match score' });
      }
    });

    // GET /api/ai/skill-gap/:jobId - Skill gap analysis
    fastify.get('/api/ai/skill-gap/:jobId', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
        const { jobId } = req.params as any;
        const [user, job] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, include: { profile: true } }),
          prisma.job.findUnique({ where: { id: jobId } }),
        ]);
        if (!user || !job) return reply.code(404).send({ error: 'Not found' });
        const userSkills: string[] = user.profile?.skills ? JSON.parse(user.profile.skills) : [];
        const jobSkills: string[] = job.requiredSkills ? JSON.parse(job.requiredSkills) : [];
        const userLower = userSkills.map((s: string) => s.toLowerCase());
        const missing = jobSkills.filter((s: string) => !userLower.includes(s.toLowerCase()));
        const matched = jobSkills.filter((s: string) => userLower.includes(s.toLowerCase()));
        const matchPct = jobSkills.length ? Math.round((matched.length / jobSkills.length) * 100) : 100;
        return { matchPct, matched, missing, userSkills, requiredSkills: jobSkills };
      } catch (err) {
        console.error('Skill gap error:', err);
        return reply.code(500).send({ error: 'Failed to calculate skill gap' });
      }
    });

    // GET /api/ai/recommendations - Get job recommendations
    fastify.get('/api/ai/recommendations', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const jobs = await getJobRecommendations(userId);
        
        // Populate match scores for recommendations
        const jobsWithScores = await Promise.all(
          jobs.map(async (job) => {
            const score = await calculateMatchScore(userId, job.id);
            return { ...job, matchScore: score };
          })
        );

        // Sort by match score desc
        jobsWithScores.sort((a, b) => b.matchScore - a.matchScore);

        return jobsWithScores;
      } catch (err) {
        console.error('AI Recommendations error:', err);
        return reply.code(500).send({ error: 'Failed to fetch recommendations' });
      }
    });

    // POST /api/ai/tailor-cover-letter - Generate customized cover letter
    fastify.post('/api/ai/tailor-cover-letter', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const coverSchema = z.object({ jobId: z.string().min(1) });
        const cparsed = coverSchema.safeParse(req.body);
        if (!cparsed.success) return reply.code(400).send({ error: 'Validation failed', details: cparsed.error.flatten() });
        const { jobId } = cparsed.data;
        if (!jobId) return reply.code(400).send({ error: 'jobId is required' });

        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { profile: true }
        });
        const job = await prisma.job.findUnique({ where: { id: jobId } });

        if (!user || !user.profile || !job) {
          return reply.code(404).send({ error: 'User, profile, or job not found' });
        }

        // Generate AI cover letter via DeepSeek
        const skillsList = JSON.parse(user.profile.skills || '[]')?.join(', ') || 'none';
        const reqSkills = JSON.parse(job.requiredSkills || '[]')?.slice(0, 5).join(', ') || 'none';
        const prompt = `Write a professional job application cover letter from ${user.fullName || 'Candidate'} for the ${job.title} position at ${job.company}.
Candidate skills: ${skillsList}
Job required skills: ${reqSkills}
Job description summary: ${(job.description || '').substring(0, 400)}
Keep it concise (3 paragraphs), professional, no subject line, plain text.`;

        let coverLetter: string;
        try {
          const { openai } = await import('./services/openaiClient');
          const resp = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.7,
          });
          coverLetter = resp.choices[0]?.message?.content?.trim() || '';
        } catch (aiErr: any) {
          console.warn('DeepSeek cover letter fallback:', aiErr.message);
          coverLetter = `Dear Hiring Manager at ${job.company},\n\nI am writing to express my interest in the ${job.title} position. With skills in ${skillsList}, I am confident I can contribute to your team.\n\nI look forward to discussing this opportunity.\n\nSincerely,\n${user.fullName || 'InstaJob Candidate'}`;
        }

        return { coverLetter };
      } catch (err) {
        console.error('AI Cover Letter error:', err);
        return reply.code(500).send({ error: 'Failed to generate cover letter' });
      }
    });

    // ========== ADMIN ENDPOINTS (PROTECTED) ==========

    // Middleware: Check if user is admin
    const isAdmin = (userId: string) => {
      const adminIds = process.env.ADMIN_IDS?.split(',').map(id => id.trim()).filter(Boolean) || [];
      return adminIds.includes(userId);
    };

    // POST /api/jobs/scout - Manual trigger job scout (admin only)
    fastify.post('/api/jobs/scout', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId || !isAdmin(userId)) return reply.code(403).send({ error: 'Forbidden: Admin access required' });
        const { scoutJobsFromRemotive } = await import('./services/jobScoutService');
        const queries = ['software engineer', 'data scientist', 'product manager', 'devops engineer', 'mobile developer', 'frontend developer', 'backend developer', 'UI UX designer', 'programmer', 'data analyst', 'full stack developer'];
        const results = await Promise.all(queries.map(q => scoutJobsFromRemotive(q, 15)));
        const total = results.reduce((a, b) => a + b, 0);
        return { inserted: total, message: `Scout complete: ${total} new jobs inserted` };
      } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // GET /api/admin/users - List all users
    fastify.get('/api/admin/users', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId || !isAdmin(userId)) {
          return reply.code(403).send({ error: 'Forbidden: Admin access required' });
        }

        const users = await prisma.user.findMany({
          select: {
            id: true,
            email: true,
            fullName: true,
            subscriptionType: true,
            level: true,
            points: true,
            createdAt: true,
            isTelegramLinked: true
          },
          orderBy: { createdAt: 'desc' }
        });

        return {
          total: users.length,
          users
        };
      } catch (err) {
        console.error('Admin get users error:', err);
        return reply.code(500).send({ error: 'Failed to fetch users' });
      }
    });

    // POST /api/admin/users/:id/suspend - Suspend user account
    fastify.post('/api/admin/users/:id/suspend', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId || !isAdmin(userId)) {
          return reply.code(403).send({ error: 'Forbidden: Admin access required' });
        }

        const { id } = req.params as any;
        const suspendSchema = z.object({ reason: z.string().optional() });
        const susparsed = suspendSchema.safeParse(req.body);
        if (!susparsed.success) return reply.code(400).send({ error: 'Validation failed', details: susparsed.error.flatten() });
        const { reason } = susparsed.data;

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return reply.code(404).send({ error: 'User not found' });

        // For demo: we'll add a 'suspended' field to track this
        // In real app, you'd have a User.status field or separate Suspension table
        await prisma.user.update({
          where: { id },
          data: {
            // We'd update a status field here
            // For now, just log the action
          }
        });

        return {
          success: true,
          message: `User ${user.email} suspended`,
          reason
        };
      } catch (err) {
        console.error('Admin suspend user error:', err);
        return reply.code(500).send({ error: 'Failed to suspend user' });
      }
    });

    // GET /api/admin/subscriptions - Subscription analytics
    fastify.get('/api/admin/subscriptions', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId || !isAdmin(userId)) {
          return reply.code(403).send({ error: 'Forbidden: Admin access required' });
        }

        const subscriptions = await prisma.subscription.findMany({
          include: { user: { select: { email: true, fullName: true } } }
        });

        const stats = {
          total: subscriptions.length,
          free: subscriptions.filter(s => s.plan === 'free').length,
          pro: subscriptions.filter(s => s.plan === 'pro').length,
          premium: subscriptions.filter(s => s.plan === 'premium').length,
          active: subscriptions.filter(s => !s.expiresAt || new Date(s.expiresAt) > new Date()).length,
          expired: subscriptions.filter(s => s.expiresAt && new Date(s.expiresAt) <= new Date()).length
        };

        return stats;
      } catch (err) {
        console.error('Admin subscriptions error:', err);
        return reply.code(500).send({ error: 'Failed to fetch subscription analytics' });
      }
    });

    // GET /api/admin/health - System health monitoring
    fastify.get('/api/admin/health', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId || !isAdmin(userId)) {
          return reply.code(403).send({ error: 'Forbidden: Admin access required' });
        }

        const userCount = await prisma.user.count();
        const jobCount = await prisma.job.count();
        const applicationCount = await prisma.application.count();
        const subscriptionCount = await prisma.subscription.count();

        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          database: {
            users: userCount,
            jobs: jobCount,
            applications: applicationCount,
            subscriptions: subscriptionCount
          },
          uptime: process.uptime(),
          environment: process.env.NODE_ENV || 'development'
        };
      } catch (err) {
        console.error('Admin health check error:', err);
        return reply.code(500).send({ error: 'Failed to get system health' });
      }
    });

    const port = parseInt(process.env.PORT || '3001', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`InstaJob API listening on http://127.0.0.1:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

start();
