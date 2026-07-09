import { Telegraf } from 'telegraf';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
export const bot = new Telegraf(botToken);

// Handle /start with token: /start REF_CODE
bot.start(async (ctx) => {
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
    } catch (err) {
      console.error('Error linking Telegram:', err);
      return ctx.reply('Terjadi kesalahan saat menghubungkan akun.');
    }
  }

  ctx.reply('Halo! Selamat datang di InstaJob Bot 🚀\n\nKetik /jobs untuk melihat lowongan terbaru.\nKetik /connect [KODE] untuk menghubungkan akun InstaJob Anda.\nKetik /stats untuk melihat statistik lamaran Anda.');
});

// Command: /connect [KODE_REFERRAL]
bot.command('connect', async (ctx) => {
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
  } catch (err) {
    console.error('Connect error:', err);
    return ctx.reply('Gagal menghubungkan akun.');
  }
});

// Command: /stats
bot.command('stats', async (ctx) => {
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

    return ctx.reply(`📊 Statistik InstaJob Anda:\n\n` +
      `- Total Lamaran: ${applications}\n` +
      `- Terkirim Hari Ini: ${appliedToday}/5\n` +
      `- Total Auto-Apply: ${totalApplied}`);
  } catch (err) {
    console.error('Stats error:', err);
    return ctx.reply('Gagal mengambil statistik.');
  }
});

// Command: /jobs
bot.command('jobs', async (ctx) => {
  try {
    const jobs = await prisma.job.findMany({
      take: 5,
      orderBy: { postedAt: 'desc' }
    });

    if (jobs.length === 0) {
      return ctx.reply('Belum ada lowongan pekerjaan baru saat ini.');
    }

    let response = '💼 Lowongan Pekerjaan Terbaru:\n\n';
    jobs.forEach((job, index) => {
      const salaryStr = job.salaryMin && job.salaryMax 
        ? `\n💰 Gaji: Rp${job.salaryMin.toLocaleString()} - Rp${job.salaryMax.toLocaleString()}`
        : '';
      const remoteStr = job.remote ? ' (Remote)' : ' (Onsite/Hybrid)';
      
      response += `${index + 1}. ${job.title} di ${job.company} (${job.location})${remoteStr}${salaryStr}\n` +
        `🔗 Detail: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/jobs/${job.id}\n\n`;
    });

    return ctx.reply(response);
  } catch (err) {
    console.error('Jobs error:', err);
    return ctx.reply('Gagal mengambil daftar pekerjaan.');
  }
});

// Command: /apply [job_id]
bot.command('apply', async (ctx) => {
  return ctx.reply('Silakan lakukan auto-apply secara mudah melalui web dashboard kami untuk mencocokkan CV Anda dengan profil kerja.');
});

// Service function: Link user account manually via HTTP API if needed
export const linkTelegramUser = async (userId: string, telegramChatId: string) => {
  return prisma.user.update({
    where: { id: userId },
    data: {
      telegramChatId,
      isTelegramLinked: true
    }
  });
};

// Notify user via telegram
export const sendTelegramNotification = async (userId: string, message: string) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user && user.isTelegramLinked && user.telegramChatId) {
      await bot.telegram.sendMessage(user.telegramChatId, message, { parse_mode: 'Markdown' });
      return true;
    }
    return false;
  } catch (err) {
    console.error('Telegram notification error:', err);
    return false;
  }
};

// Send daily digest to all linked users
export const sendDailyDigest = async () => {
  try {
    const linkedUsers = await prisma.user.findMany({
      where: { isTelegramLinked: true, telegramChatId: { not: null } }
    });

    if (linkedUsers.length === 0) return;

    const recentJobs = await prisma.job.findMany({
      take: 3,
      orderBy: { postedAt: 'desc' }
    });

    if (recentJobs.length === 0) return;

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
          await bot.telegram.sendMessage(user.telegramChatId, digestMessage, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`Failed to send digest to user ${user.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Daily digest error:', err);
  }
};

export const startBot = async () => {
  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not found!');
    return;
  }
  // Start bot in background non-blocking
  bot.launch().catch(err => {
    console.error('Telegraf launch error:', err);
  });
  console.log('Telegram Bot has been launched.');
};
