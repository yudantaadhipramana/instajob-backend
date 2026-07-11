import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

export async function registerAffiliateRoutes(fastify: any) {
  // GET /api/affiliate/dashboard - Overview dashboard
  fastify.get('/api/affiliate/dashboard', 
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            affiliateTier: true,
            totalEarnings: true,
            pendingPayout: true,
            referralStat: true,
            referrals: {
              select: { id: true, email: true, createdAt: true }
            }
          }
        });

        if (!user) return reply.status(404).send({ error: 'User not found' });

        const tierNames = ['20%', '25%', '28%', '30%'];
        const tierCommission = [20, 25, 28, 30][user.affiliateTier - 1] || 20;

        reply.send({
          tier: user.affiliateTier,
          tierName: `Tier ${user.affiliateTier}`,
          commission: `${tierCommission}%`,
          totalEarnings: user.totalEarnings,
          pendingPayout: user.pendingPayout,
          referralStats: user.referralStat || {
            totalClicks: 0,
            totalSignups: 0,
            totalConversions: 0,
            conversionRate: 0
          },
          referralCount: user.referrals.length,
          recentReferrals: user.referrals.slice(0, 5)
        });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // GET /api/affiliate/referrals - List semua referrals
  fastify.get('/api/affiliate/referrals',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const page = (req.query.page as number) || 1;
        const limit = (req.query.limit as number) || 20;
        const skip = (page - 1) * limit;

        const referrals = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            referrals: {
              select: {
                id: true,
                email: true,
                subscriptionType: true,
                createdAt: true
              },
              skip,
              take: limit
            }
          }
        });

        const total = await prisma.user.count({
          where: { referredById: userId }
        });

        reply.send({
          referrals: referrals?.referrals || [],
          pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // GET /api/affiliate/earnings - Earnings history
  fastify.get('/api/affiliate/earnings',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            totalEarnings: true,
            pendingPayout: true,
            referralStat: true,
            payouts: {
              select: {
                id: true,
                amount: true,
                status: true,
                method: true,
                createdAt: true,
                paidAt: true
              },
              orderBy: { createdAt: 'desc' },
              take: 10
            }
          }
        });

        reply.send({
          summary: {
            totalEarnings: user?.totalEarnings || 0,
            pendingPayout: user?.pendingPayout || 0,
            paidOut: (user?.totalEarnings || 0) - (user?.pendingPayout || 0),
            conversionRate: user?.referralStat?.conversionRate || 0
          },
          recentPayouts: user?.payouts || []
        });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // POST /api/affiliate/request-payout - Request pembayaran
  fastify.post('/api/affiliate/request-payout',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const { amount, method, details } = req.body as { amount: number; method: string; details?: string };

        if (!amount || amount <= 0) {
          return reply.status(400).send({ error: 'Invalid amount' });
        }
        if (!['BANK_TRANSFER', 'PAYPAL', 'EWALLET'].includes(method)) {
          return reply.status(400).send({ error: 'Invalid payment method' });
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { pendingPayout: true }
        });

        if (!user || user.pendingPayout < amount) {
          return reply.status(400).send({ error: 'Insufficient balance' });
        }

        const payout = await prisma.payout.create({
          data: {
            userId,
            amount,
            method,
            details: details || '',
            status: 'PENDING'
          }
        });

        // Update user pending payout
        await prisma.user.update({
          where: { id: userId },
          data: { pendingPayout: { decrement: amount } }
        });

        reply.send({ success: true, payout });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // GET /api/affiliate/payouts - Payout history
  fastify.get('/api/affiliate/payouts',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;

        const payouts = await prisma.payout.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amount: true,
            status: true,
            method: true,
            createdAt: true,
            paidAt: true
          }
        });

        reply.send({ payouts });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );
}
