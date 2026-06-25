"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationWorker = exports.notificationQueue = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const client_1 = require("@prisma/client");
const telegramBot_1 = require("./telegramBot");
const prisma = new client_1.PrismaClient();
const connection = new ioredis_1.default({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
});
exports.notificationQueue = new bullmq_1.Queue('user-notifications', { connection: connection });
exports.notificationWorker = new bullmq_1.Worker('user-notifications', async (job) => {
    const { userId, title, message, type } = job.data;
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isTelegramLinked: true, telegramChatId: true }
        });
        let sentToTelegram = false;
        // If user linked their Telegram, send notification via bot
        if (user?.isTelegramLinked && user.telegramChatId) {
            await (0, telegramBot_1.sendTelegramNotification)(user.telegramChatId, `🔔 **${title}**\n\n${message}`);
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
    }
    catch (err) {
        console.error('Notification worker error:', err);
        throw err;
    }
}, { connection: connection, concurrency: 5 });
exports.notificationWorker.on('completed', (job, result) => {
    console.log(`Notification job ${job.id} completed. Sent to Telegram: ${result.sentToTelegram}`);
});
exports.notificationWorker.on('failed', (job, err) => {
    console.error(`Notification job ${job?.id} failed:`, err.message);
});
