import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { authRoutes } from './auth';
import { emailQueue } from './services/emailQueue';
import { notificationQueue } from './services/notificationQueue';
import { jobScrapingQueue } from './services/jobScrapingQueue';
import { startBot, bot, linkTelegramUser } from './services/telegramBot';
import { canUserApply, incrementApplyCount, getUserQuota } from './services/rateLimit';
import { calculateMatchScore, getJobRecommendations } from './services/aiService';
import { registerRateLimit, authRateLimit, inputSanitizeHook, authValidationHook, securityHeadersHook } from './middleware/security';

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

const start = async () => {
  try {
    // CORS — allow only known frontend origins (no wildcard)
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,https://instajob-frontend.vercel.app')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    await fastify.register(cors, {
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
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

    // JWT Plugin
    await fastify.register(jwt, {
      secret: process.env.JWT_SECRET || 'instajob-secret-key-2026-change-in-production'
    });

    // Global rate limiting (120 req/min)
    await registerRateLimit(fastify);

    // Auth Routes
    await fastify.register(authRoutes);

    // Start Telegram Bot
    await startBot();

    // Start Background Job Workers
    console.log('Starting background job workers...');
    
    // Schedule: Job scraping every 6 hours
    const scheduleJobScraping = () => {
      const now = new Date();
      const hours = now.getHours();
      if (hours % 6 === 0 && hours !== 0) {
        jobScrapingQueue.add('daily-scrape-linkedin', {
          source: 'LinkedIn',
          query: 'software engineer',
        });
        jobScrapingQueue.add('daily-scrape-indeed', {
          source: 'Indeed',
          query: 'software engineer',
        });
      }
    };
    
    scheduleJobScraping();
    setInterval(scheduleJobScraping, 3600000); // Check every hour
    
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
      fastify.addHook('onRequest', async (req, reply) => {
        try {
          await req.jwtVerify();
        } catch (err) {
          reply.code(401).send({ error: 'Unauthorized' });
        }
      });

      // ========== USER PROFILE ENDPOINTS (PROTECTED) ==========
      
      // GET /api/user/profile - Get user profile
      fastify.get('/api/user/profile', async (req: any, reply: any) => {
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

      // PUT /api/user/profile - Update user profile
      fastify.put('/api/user/profile', async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const { bio, skills, experience, location, resumeUrl } = req.body as any;

          let profile = await prisma.userProfile.findUnique({
            where: { userId }
          });

          if (!profile) {
            profile = await prisma.userProfile.create({
              data: {
                userId,
                bio,
                skills: skills || [],
                experience,
                location,
                resumeUrl
              }
            });
          } else {
            profile = await prisma.userProfile.update({
              where: { userId },
              data: {
                bio: bio || profile.bio,
                skills: skills || profile.skills,
                experience: experience || profile.experience,
                location: location || profile.location,
                resumeUrl: resumeUrl || profile.resumeUrl
              }
            });
          }

          return reply.code(200).send({
            message: 'Profile updated successfully',
            profile
          });
        } catch (err) {
          console.error('Update profile error:', err);
          return reply.code(500).send({ error: 'Failed to update profile' });
        }
      });

      // ========== TELEGRAM ENDPOINTS (PROTECTED) ==========

      // GET /api/telegram/link-status - Check if user has linked Telegram
      fastify.get('/api/telegram/link-status', async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

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
      fastify.post('/api/telegram/unlink', async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
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

      // ========== EXTENSION ENDPOINTS (PROTECTED) ==========
      fastify.post('/api/extension/sync-apply', async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const { title, company, location, description, url, isApplied } = req.body as any;
          if (!title || !company) return reply.code(400).send({ error: 'Title and company required' });

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
      fastify.get('/api/auto-apply/quota', async (req: any, reply: any) => {
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
      fastify.post('/api/auto-apply/queue', async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const { jobId } = req.body as any;
          if (!jobId) return reply.code(400).send({ error: 'jobId required' });

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

          // Add to BullMQ for async processing
          await emailQueue.add('send-application', {
            userId,
            jobId,
            jobTitle: job.title,
            company: job.company,
            userEmail: req.user.email || 'user@instajob.com'
          });

          // Send notification via queue
          await notificationQueue.add('notify', {
            userId,
            title: 'Auto-Apply Queued',
            message: `Your application for ${job.title} at ${job.company} has been queued for auto-apply.`,
            type: 'auto_apply_queued'
          });

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
      fastify.get('/api/auto-apply/queue', async (req: any, reply: any) => {
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
      fastify.get('/api/notifications', async (req: any, reply: any) => {
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
      fastify.get('/api/referral/my-code', async (req: any, reply: any) => {
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
      fastify.post('/api/referral/redeem', async (req: any, reply: any) => {
        try {
          const userId = req.user?.sub || req.user?.userId;
          if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

          const { referralCode } = req.body as any;
          if (!referralCode) return reply.code(400).send({ error: 'Referral code required' });

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
      fastify.get('/api/referral/leaderboard', async (req: any, reply: any) => {
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
      fastify.get('/api/referral/rewards', async (req: any, reply: any) => {
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
fastify.get('/api/bookmarks', async (req: any, reply: any) => {
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
fastify.post('/api/jobs/:jobId/bookmark', async (req: any, reply: any) => {
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
fastify.delete('/api/jobs/:jobId/bookmark', async (req: any, reply: any) => {
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

      // ========== GAMIFICATION ENDPOINTS (PROTECTED) ==========

      // GET /api/gamification/profile - Get user's gamification profile
      fastify.get('/api/gamification/profile', async (req: any, reply: any) => {
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
      fastify.post('/api/gamification/check-in', async (req: any, reply: any) => {
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
      fastify.get('/api/gamification/achievements', async (req: any, reply: any) => {
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
        const { page = 1, search, remote, salaryMin, salaryMax } = req.query as any;
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

    // GET /api/jobs/:id - Get job details
    fastify.get('/api/jobs/:id', async (req: any, reply: any) => {
      try {
        const { id } = req.params;

        const job = await prisma.job.findUnique({
          where: { id },
          include: { applications: { select: { id: true, status: true } } }
        });

        if (!job) return reply.code(404).send({ error: 'Job not found' });

        return job;
      } catch (err) {
        console.error('Job detail error:', err);
        return reply.code(500).send({ error: 'Failed to fetch job' });
      }
    });

    // ========== APPLICATIONS ENDPOINTS ==========
    
    // POST /api/applications - Create application
    fastify.post('/api/applications', async (req: any, reply: any) => {
      try {
        const userId = req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const { jobId, notes } = req.body as any;

        if (!jobId) return reply.code(400).send({ error: 'jobId required' });

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
    fastify.get('/api/applications', async (req: any, reply: any) => {
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
    fastify.get('/api/dashboard/stats', async (req: any, reply: any) => {
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
    fastify.get('/api/analytics/overview', async (req: any, reply: any) => {
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
    fastify.get('/api/analytics/timeline', async (req: any, reply: any) => {
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
    fastify.get('/api/analytics/industries', async (req: any, reply: any) => {
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
    fastify.get('/api/analytics/time-to-hire', async (req: any, reply: any) => {
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
    fastify.get('/api/subscription/status', async (req: any, reply: any) => {
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
              features: ['basic_search', 'job_bookmarking', 'application_tracking']
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
    fastify.post('/api/subscription/upgrade', async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const { plan, months } = req.body as any;
        
        if (!plan || !['pro', 'premium'].includes(plan)) {
          return reply.code(400).send({ error: 'Invalid plan' });
        }

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
              features: ['unlimited_applications', 'ai_matching', 'cover_letter_boost', 'basic_search', 'job_bookmarking', 'application_tracking']
            }
          });
        } else {
          subscription = await prisma.subscription.update({
            where: { userId },
            data: {
              plan,
              expiresAt,
              features: ['unlimited_applications', 'ai_matching', 'cover_letter_boost', 'basic_search', 'job_bookmarking', 'application_tracking']
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
    fastify.post('/api/subscription/cancel', async (req: any, reply: any) => {
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
              features: ['basic_search', 'job_bookmarking', 'application_tracking']
            }
          });
        } else {
          subscription = await prisma.subscription.create({
            data: {
              userId,
              plan: 'free',
              features: ['basic_search', 'job_bookmarking', 'application_tracking']
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
    fastify.get('/api/ai/match-score/:jobId', async (req: any, reply: any) => {
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

    // GET /api/ai/recommendations - Get job recommendations
    fastify.get('/api/ai/recommendations', async (req: any, reply: any) => {
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
    fastify.post('/api/ai/tailor-cover-letter', async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const { jobId } = req.body as any;
        if (!jobId) return reply.code(400).send({ error: 'jobId is required' });

        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { profile: true }
        });
        const job = await prisma.job.findUnique({ where: { id: jobId } });

        if (!user || !user.profile || !job) {
          return reply.code(404).send({ error: 'User, profile, or job not found' });
        }

        // Generate tailored cover letter using mock/prompt
        const skillsList = user.profile.skills?.join(', ') || 'Not specified';
        const coverLetter = `
Dear Hiring Manager at ${job.company},

I am writing to express my strong interest in the ${job.title} position at ${job.company}. With a background in the field and key skills including ${skillsList}, I am confident in my ability to contribute effectively to your team.

Your job description highlights the need for someone experienced with ${job.requiredSkills?.slice(0, 3).join(', ') || 'relevant industry practices'}. In my previous experience, I have successfully applied similar capabilities to achieve impactful results. For instance, my work in ${user.profile.location || 'software engineering'} aligned closely with your current initiatives.

I am enthusiastic about the opportunity to join ${job.company} and would welcome the chance to discuss how my qualifications align with your needs in more detail.

Sincerely,
${user.fullName || 'InstaJob Candidate'}
        `.trim();

        return { coverLetter };
      } catch (err) {
        console.error('AI Cover Letter error:', err);
        return reply.code(500).send({ error: 'Failed to generate cover letter' });
      }
    });

    // ========== ADMIN ENDPOINTS (PROTECTED) ==========

    // Middleware: Check if user is admin
    const isAdmin = (userId: string) => {
      // Mock admin check: hardcode admin user ID or email
      const adminIds = process.env.ADMIN_IDS?.split(',') || ['admin-user-id'];
      return adminIds.includes(userId);
    };

    // GET /api/admin/users - List all users
    fastify.get('/api/admin/users', async (req: any, reply: any) => {
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
    fastify.post('/api/admin/users/:id/suspend', async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId || !isAdmin(userId)) {
          return reply.code(403).send({ error: 'Forbidden: Admin access required' });
        }

        const { id } = req.params as any;
        const { reason } = req.body as any;

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
    fastify.get('/api/admin/subscriptions', async (req: any, reply: any) => {
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
    fastify.get('/api/admin/health', async (req: any, reply: any) => {
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
