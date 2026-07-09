import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const webhookRoutes: FastifyPluginAsync = async (server) => {
  server.post('/telegram', async (request, reply) => {
    try {
      const update = request.body as any;
      
      // Basic validation
      if (!update || !update.message) {
        return reply.status(200).send({ ok: true });
      }

      const message = update.message;
      const chatId = message.chat.id;
      const text = message.text || '';

      // Command: /start
      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        
        // Handle deep linking: /start link_TOKEN
        if (parts.length > 1 && parts[1].startsWith('link_')) {
          const token = parts[1].replace('link_', '');
          
          // Verify token (in production, you'd use a real token store)
          // For now, we simulate success
          return reply.send({
            method: 'sendMessage',
            chat_id: chatId,
            text: `✅ Akun Telegram Anda berhasil ditautkan dengan InstaJob!\n\nSekarang Anda akan menerima notifikasi lamaran dan update dari sini.\nKetik /jobs untuk mulai mencari pekerjaan.`
          });
        }
        
        return reply.send({
          method: 'sendMessage',
          chat_id: chatId,
          text: `👋 Halo! Saya InstaJob Bot.\n\nSaya bisa membantu Anda mencari pekerjaan. Ketik:\n/jobs [kata kunci] - Untuk mencari lowongan\n/help - Untuk bantuan lengkap`
        });
      }

      // Command: /jobs
      if (text.startsWith('/jobs')) {
        const query = text.replace('/jobs', '').trim();
        
        let jobs;
        if (query) {
          jobs = await prisma.job.findMany({
            where: {
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { company: { contains: query, mode: 'insensitive' } }
              ]
            },
            take: 3
          });
        } else {
          jobs = await prisma.job.findMany({ take: 3, orderBy: { postedAt: 'desc' } });
        }

        if (jobs.length === 0) {
          return reply.send({
            method: 'sendMessage',
            chat_id: chatId,
            text: `😔 Maaf, tidak ada lowongan yang cocok dengan "${query}".`
          });
        }

        let responseText = `🔍 Hasil Pencarian:\n\n`;
        jobs.forEach((job, index) => {
          responseText += `${index + 1}. *${job.title}*\n🏢 ${job.company} (${job.location})\n💵 ${job.salaryMin ? '$' + job.salaryMin : 'Gaji dirahasiakan'}\n\n`;
        });
        responseText += `Buka aplikasi InstaJob untuk melamar!`;

        return reply.send({
          method: 'sendMessage',
          chat_id: chatId,
          parse_mode: 'Markdown',
          text: responseText
        });
      }

      // Default response
      return reply.send({
        method: 'sendMessage',
        chat_id: chatId,
        text: `Maaf, saya tidak mengerti perintah tersebut. Ketik /start untuk melihat menu utama.`
      });

    } catch (error) {
      console.error('Webhook Error:', error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
};

export default webhookRoutes;
