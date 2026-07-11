import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { sendTelegramNotification } from './telegramBot';

const prisma = new PrismaClient();

const workersEnabled = process.env.ENABLE_WORKERS !== 'false';
const connection = workersEnabled ? new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
}) : null;
if (connection) connection.on('error', () => {});

export const notificationQueue = workersEnabled && connection
  ? new Queue('user-notifications', { connection: connection as any })
  : null as any;

export const notificationWorker = new Worker(
  'user-notifications',
  async (job) => {
    const { userId, title, message, type } = job.data;
    
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isTelegramLinked: true, telegramChatId: true }
      });

      let sentToTelegram = false;

      // If user linked their Telegram, send notification via bot
      if (user?.isTelegramLinked && user.telegramChatId) {
        await sendTelegramNotification(user.telegramChatId, `🔔 **${title}**\n\n${message}`);
        sentToTelegram = true;
      }

      // Always save notification to the database
      await prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type,
          sentToTelegram
        }
      });
      
      console.log(`Notification processed for user ${userId}`);
      return { success: true, sentToTelegram };
    } catch (err) {
      console.error('Notification worker error:', err);
      throw err;
    }
  },
  { connection: connection as any, concurrency: 5 }
);

notificationWorker.on('completed', (job, result) => {
  console.log(`Notification job ${job.id} completed. Sent to Telegram: ${result.sentToTelegram}`);
});

notificationWorker.on('failed', (job, err) => {
  console.error(`Notification job ${job?.id} failed:`, err.message);
});
