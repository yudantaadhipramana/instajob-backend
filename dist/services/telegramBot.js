"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBot = exports.sendDailyDigest = exports.sendTelegramNotification = exports.linkTelegramUser = exports.bot = void 0;
const telegraf_1 = require("telegraf");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
exports.bot = new telegraf_1.Telegraf(botToken);
// Handle /start with token: /start REF_CODE
exports.bot.start(async (ctx) => {
    const text = ctx.message.text || '';
    const args = text.split(' ');
    const refCode = args[1];
    if (refCode) {
        try {
            const user = await prisma.user.findUnique({
                where: { referralCode: refCode }
            });
            if (!user) {
                return ctx.reply('Kode referral tidak valid atau akun tidak ditemukan.');
            }
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    telegramChatId: String(ctx.chat.id),
                    isTelegramLinked: true
                }
            });
            return ctx.reply(`Akun ${user.email} berhasil dihubungkan ke Telegram! Anda sekarang akan menerima notifikasi status lamaran dan info kerja harian. 🚀`);
        }
        catch (err) {
            console.error('Error linking Telegram:', err);
            return ctx.reply('Terjadi kesalahan saat menghubungkan akun.');
        }
    }
    ctx.reply('Halo! Selamat datang di InstaJob Bot 🚀\n\nHubungkan akunmu dengan mengklik tombol di bawah ini atau ketik `/connect [KODE_REFERRAL]` Anda.', {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Buka Dashboard (Web)", url: process.env.FRONTEND_URL || "http://localhost:3000/dashboard" }]
            ]
        }
    });
});
// Command: /connect [KODE_REFERRAL]
exports.bot.command('connect', async (ctx) => {
    const text = ctx.message.text || '';
    const args = text.split(' ');
    const refCode = args[1];
    if (!refCode) {
        return ctx.reply('Gunakan format: `/connect [KODE_REFERRAL]` untuk menghubungkan akun.');
    }
    try {
        const user = await prisma.user.findUnique({
            where: { referralCode: refCode }
        });
        if (!user) {
            return ctx.reply('Kode referral tidak valid.');
        }
        await prisma.user.update({
            where: { id: user.id },
            data: {
                telegramChatId: String(ctx.chat.id),
                isTelegramLinked: true
            }
        });
        return ctx.reply(`Akun ${user.email} berhasil dihubungkan! 🚀`);
    }
    catch (err) {
        console.error('Connect error:', err);
        return ctx.reply('Gagal menghubungkan akun.');
    }
});
// Command: /stats
exports.bot.command('stats', async (ctx) => {
    try {
        const user = await prisma.user.findUnique({
            where: { telegramChatId: String(ctx.chat.id) }
        });
        if (!user) {
            return ctx.reply('Silakan hubungkan akun Anda terlebih dahulu dengan perintah `/connect [KODE_REFERRAL]`');
        }
        const [applications, quota] = await Promise.all([
            prisma.application.count({ where: { userId: user.id } }),
            prisma.applyQuota.findUnique({ where: { userId: user.id } })
        ]);
        const appliedToday = quota?.appliedToday || 0;
        const totalApplied = quota?.totalApplied || 0;
        return ctx.reply(`📊 *Statistik InstaJob Anda*:\n\n` +
            `- Total Lamaran: ${applications}\n` +
            `- Terkirim Hari Ini: ${appliedToday}/5\n` +
            `- Total Auto-Apply: ${totalApplied}`, { parse_mode: 'Markdown' });
    }
    catch (err) {
        console.error('Stats error:', err);
        return ctx.reply('Gagal mengambil statistik.');
    }
});
// Command: /jobs
exports.bot.command('jobs', async (ctx) => {
    try {
        const jobs = await prisma.job.findMany({
            take: 5,
            orderBy: { postedAt: 'desc' }
        });
        if (jobs.length === 0) {
            return ctx.reply('Belum ada lowongan pekerjaan baru saat ini.');
        }
        let response = '💼 *Lowongan Pekerjaan Terbaru*:\n\n';
        jobs.forEach((job, index) => {
            const salaryStr = job.salaryMin && job.salaryMax
                ? `\n💰 Gaji: Rp${job.salaryMin.toLocaleString()} - Rp${job.salaryMax.toLocaleString()}`
                : '';
            const remoteStr = job.remote ? ' (Remote)' : ' (Onsite/Hybrid)';
            response += `${index + 1}. *${job.title}* di *${job.company}* (${job.location})${remoteStr}${salaryStr}\n` +
                `🔗 Detail: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/jobs/${job.id}\n\n`;
        });
        return ctx.reply(response, { parse_mode: 'Markdown' });
    }
    catch (err) {
        console.error('Jobs error:', err);
        return ctx.reply('Gagal mengambil daftar pekerjaan.');
    }
});
// Command: /apply [job_id]
exports.bot.command('apply', async (ctx) => {
    return ctx.reply('Silakan lakukan auto-apply secara mudah melalui web dashboard kami untuk mencocokkan CV Anda dengan profil kerja.');
});
// Service function: Link user account manually via HTTP API if needed
const linkTelegramUser = async (userId, telegramChatId) => {
    return prisma.user.update({
        where: { id: userId },
        data: {
            telegramChatId,
            isTelegramLinked: true
        }
    });
};
exports.linkTelegramUser = linkTelegramUser;
// Notify user via telegram
const sendTelegramNotification = async (userId, message) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user && user.isTelegramLinked && user.telegramChatId) {
            await exports.bot.telegram.sendMessage(user.telegramChatId, message, { parse_mode: 'Markdown' });
            return true;
        }
        return false;
    }
    catch (err) {
        console.error('Telegram notification error:', err);
        return false;
    }
};
exports.sendTelegramNotification = sendTelegramNotification;
// Send daily digest to all linked users
const sendDailyDigest = async () => {
    try {
        const linkedUsers = await prisma.user.findMany({
            where: { isTelegramLinked: true, telegramChatId: { not: null } }
        });
        if (linkedUsers.length === 0)
            return;
        const recentJobs = await prisma.job.findMany({
            take: 3,
            orderBy: { postedAt: 'desc' }
        });
        if (recentJobs.length === 0)
            return;
        let digestMessage = '⏰ *Daily Digest: Lowongan Pilihan Hari Ini!*\n\n';
        recentJobs.forEach((job) => {
            digestMessage += `▪️ *${job.title}* - ${job.company}\n` +
                `📍 ${job.location} | ${job.remote ? 'Remote' : 'Onsite'}\n` +
                `🔗 Lamar: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/jobs/${job.id}\n\n`;
        });
        digestMessage += `Pantau terus dashboard Anda untuk mengirim lamaran otomatis! 🚀`;
        for (const user of linkedUsers) {
            if (user.telegramChatId) {
                try {
                    await exports.bot.telegram.sendMessage(user.telegramChatId, digestMessage, { parse_mode: 'Markdown' });
                }
                catch (err) {
                    console.error(`Failed to send digest to user ${user.id}:`, err);
                }
            }
        }
    }
    catch (err) {
        console.error('Daily digest error:', err);
    }
};
exports.sendDailyDigest = sendDailyDigest;
const startBot = async () => {
    if (!botToken) {
        console.error('TELEGRAM_BOT_TOKEN not found!');
        return;
    }
    // Start bot in background non-blocking
    exports.bot.launch().catch(err => {
        console.error('Telegraf launch error:', err);
    });
    console.log('Telegram Bot has been launched.');
};
exports.startBot = startBot;
