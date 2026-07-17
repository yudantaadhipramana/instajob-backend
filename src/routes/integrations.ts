import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getGoogleAuthUrl, handleGmailCallback, syncGmailInbox, disconnectGmail, sendEmailViaGmail, getGmailStatus } from '../services/gmailService';

const prisma = new PrismaClient();

export async function integrationsRoutes(fastify: any) {
  // POST /api/integrations/telegram/connect
  fastify.post('/api/integrations/telegram/connect', 
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const schema = z.object({
          telegramChatId: z.string().min(1)
        });

        const { telegramChatId } = schema.parse(req.body);
        const userId = req.user.sub || req.user.userId;

        await prisma.telegramIntegration.upsert({
          where: { userId },
          create: {
            userId,
            telegramChatId,
            isConnected: true
          },
          update: {
            telegramChatId,
            isConnected: true
          }
        });

        reply.send({ success: true, message: 'Telegram connected' });
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // GET /api/integrations/telegram/status
  fastify.get('/api/integrations/telegram/status',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const integration = await prisma.telegramIntegration.findUnique({
          where: { userId }
        });

        reply.send({
          isConnected: integration?.isConnected || false,
          chatId: integration?.telegramChatId || null,
          notificationTypes: integration?.notificationTypes ? JSON.parse(integration.notificationTypes) : []
        });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // POST /api/integrations/gmail/auth-url
  fastify.post('/api/integrations/gmail/auth-url',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const authUrl = getGoogleAuthUrl(userId);
        reply.send({ authUrl });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // GET /api/integrations/gmail/callback
  fastify.get('/api/integrations/gmail/callback', async (req: any, reply: any) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return reply.status(400).send({ error: 'Missing code or state' });
      }

      const result = await handleGmailCallback(code, state);
      return reply.redirect('https://instajob.id/settings?gmail=success');
    } catch (error: any) {
      reply.status(400).send({ error: error.message });
    }
  });

  // POST /api/integrations/gmail/sync
  fastify.post('/api/integrations/gmail/sync',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const result = await syncGmailInbox(userId);
        reply.send({ success: true, newEmails: result.newEmails });
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // DELETE /api/integrations/gmail/disconnect
  fastify.delete('/api/integrations/gmail/disconnect',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        await disconnectGmail(userId);
        reply.send({ success: true, message: 'Gmail disconnected' });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // GET /api/integrations/gmail/status
  fastify.get('/api/integrations/gmail/status',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const status = await getGmailStatus(userId);
        reply.send(status);
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );

  // POST /api/integrations/gmail/send
  fastify.post('/api/integrations/gmail/send',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user.sub || req.user.userId;
        const { to, subject, body } = req.body as { to: string; subject: string; body: string };
        if (!to || !subject || !body) {
          return reply.status(400).send({ error: 'to, subject, body required' });
        }
        const result = await sendEmailViaGmail(userId, to, subject, body);
        reply.send({ success: true, messageId: result.messageId });
      } catch (error: any) {
        reply.status(500).send({ error: error.message });
      }
    }
  );
}
