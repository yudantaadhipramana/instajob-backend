import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { sendTelegramNotification } from './telegramBot';
import { openai } from './openaiClient';

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

export const emailQueue = workersEnabled && connection
  ? new Queue('auto-apply-emails', { connection: connection as any })
  : null as any;

// Send via Resend HTTP API (no SMTP firewall issues)
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'InstaJob <onboarding@resend.dev>',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

// Worker: Process email queue jobs
export const emailWorker = workersEnabled && connection
  ? new Worker(
  'auto-apply-emails',
  async (job) => {
    try {
      const { userId, jobId, jobTitle, company, userEmail } = job.data;

      // Get application from DB
      const application = await prisma.autoApplyQueue.findUnique({
        where: { userId_jobId: { userId, jobId } },
        include: { 
          user: { include: { profile: true } }, 
          job: true 
        },
      });

      if (!application) {
        throw new Error(`Application not found for user ${userId}, job ${jobId}`);
      }

      // Extract emailTemplate from user preferences
      const prefs = application.user.profile?.jobPreferences 
        ? JSON.parse(application.user.profile.jobPreferences) 
        : {};
      const emailTemplate = prefs.emailTemplate || '';

      // Generate AI-personalized application email
      const emailContent = await generateAIEmail(
        application.user.fullName || 'User',
        application.job.title,
        application.job.company,
        emailTemplate
      );

      // Send via Resend
      await sendEmail(
        process.env.MOCK_RECIPIENT_EMAIL || 'test@example.com',
        `Application for ${jobTitle} at ${company}`,
        emailContent,
      );

      // Update queue status
      await prisma.autoApplyQueue.update({
        where: { id: application.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
        },
      });

      // Create notification
      await prisma.notification.create({
        data: {
          userId,
          title: 'Application Sent',
          message: `Your application for ${jobTitle} at ${company} has been sent.`,
          type: 'application_sent',
        },
      });

      return { success: true, applicationId: application.id };
    } catch (error) {
      console.error('Email queue error:', error);
      throw error;
    }
  },
  { connection: connection as any, concurrency: 3 }
) : null as any;

// Event handlers
emailWorker?.on('completed', (job: any) => {
  console.log(`Job ${job.id} completed successfully`);
});

emailWorker?.on('failed', async (job: any, err: any) => {
  console.error(`Job ${job?.id} failed:`, err?.message);
  if (job) {
    const { userId, jobId } = job.data;
    await prisma.autoApplyQueue.updateMany({
      where: { userId, jobId },
      data: {
        status: 'failed',
        errorMessage: err?.message || 'Unknown error',
      },
    });
  }
});

// SYNC PROCESSOR (dev environment workaround for BullMQ connection contention)
export async function processEmailQueueSync(userId: string, jobId: string) {
  try {
    const application = await prisma.autoApplyQueue.findUnique({
      where: { userId_jobId: { userId, jobId } },
      include: { 
        user: { include: { profile: true } }, 
        job: true 
      },
    });

    if (!application) {
      console.warn(`Email job not found: ${userId}/${jobId}`);
      return;
    }

    // Extract emailTemplate from user preferences
    const prefs = application.user.profile?.jobPreferences 
      ? JSON.parse(application.user.profile.jobPreferences) 
      : {};
    const emailTemplate = prefs.emailTemplate || '';

    // Generate AI-personalized application email
    const emailContent = await generateAIEmail(
      application.user.fullName || 'User',
      application.job.title,
      application.job.company,
      emailTemplate
    );

    console.log(`\n=== GENERATED EMAIL CONTENT [${userId}/${jobId}] ===\n${emailContent}\n=========================================\n`);

    // Send via Resend
    await sendEmail(
      process.env.MOCK_RECIPIENT_EMAIL || 'test@example.com',
      `Application for ${application.job.title} at ${application.job.company}`,
      emailContent,
    );

    // Update status to sent
    await prisma.autoApplyQueue.update({
      where: { userId_jobId: { userId, jobId } },
      data: { status: 'sent', emailContent }
    });

    console.log(`Email processed: ${userId}/${jobId}`);
  } catch (err) {
    console.error(`Email processing failed: ${userId}/${jobId}`, err);
    await prisma.autoApplyQueue.update({
      where: { userId_jobId: { userId, jobId } },
      data: { status: 'failed', errorMessage: String(err) }
    }).catch(() => {});
  }
}

// Helper: Generate AI-powered personalized application email
async function generateAIEmail(
  userName: string,
  jobTitle: string,
  company: string,
  emailTemplate: string,
  recruiterName: string = 'Hiring Manager'
): Promise<string> {
  // Custom template: substitute placeholders, wrap HTML
  if (emailTemplate?.trim()) {
    const content = emailTemplate
      .replace(/{recruiter}/g, recruiterName)
      .replace(/{role}/g, jobTitle)
      .replace(/{company}/g, company);
    return `<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333">
      <p>${content.replace(/\n/g, '</p><p>')}</p>
      <p>Best regards,<br/><strong>${userName}</strong></p>
      <hr/><p style="font-size:12px;color:#666">Sent via InstaJob on ${new Date().toLocaleDateString()}</p>
    </body></html>`;
  }

  // AI-generated email via OpenAI
  try {
    const prompt = `Write a professional job application email from ${userName} applying for ${jobTitle} at ${company}. 
Address it to ${recruiterName}. Keep it concise (3 short paragraphs), professional, and genuine. 
Do not include subject line. Plain text only, no markdown.`;

    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.7,
    });

    const text = completion.choices[0]?.message?.content?.trim() || '';
    return `<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333">
      <p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>
      <hr/><p style="font-size:12px;color:#666">AI-generated via InstaJob on ${new Date().toLocaleDateString()}</p>
    </body></html>`;
  } catch (err: any) {
    console.warn('[EmailQueue] OpenAI failed, using fallback:', err.message);
    // Fallback: basic template
    return `<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333">
      <p>Dear ${recruiterName},</p>
      <p>I am writing to express my interest in the ${jobTitle} position at ${company}. I believe my background and skills make me a strong candidate for this role.</p>
      <p>I look forward to discussing how I can contribute to your team.</p>
      <p>Best regards,<br/><strong>${userName}</strong></p>
      <hr/><p style="font-size:12px;color:#666">Sent via InstaJob on ${new Date().toLocaleDateString()}</p>
    </body></html>`;
  }
}

// Cleanup function
export async function closeEmailQueue() {
  await emailQueue.close();
  await emailWorker?.close();
  connection?.disconnect();
}
