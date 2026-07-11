import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { sendTelegramNotification } from './telegramBot';

const prisma = new PrismaClient();

// Redis connection for BullMQ — skip if ENABLE_WORKERS=false
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

// Email transporter (mock - replace with real SMTP in production)
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Worker: Process email queue jobs
export const emailWorker = new Worker(
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

      // Send email (mock - in production, send to company)
      await emailTransporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@instajob.com',
        to: process.env.MOCK_RECIPIENT_EMAIL || 'test@example.com',
        subject: `Application for ${jobTitle} at ${company}`,
        html: emailContent,
      });

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
);

// Event handlers
emailWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

emailWorker.on('failed', async (job, err) => {
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

    // Send email (mock)
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@instajob.com',
      to: process.env.MOCK_RECIPIENT_EMAIL || 'test@example.com',
      subject: `Application for ${application.job.title} at ${application.job.company}`,
      html: emailContent,
    });

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

// Helper: Generate AI-powered personalized email (mock OpenAI for Phase I dev)
async function generateAIEmail(
  userName: string,
  jobTitle: string,
  company: string,
  emailTemplate: string,
  recruiterName: string = 'Hiring Manager'
): Promise<string> {
  // If user has custom template, use it with placeholder replacement
  if (emailTemplate?.trim()) {
    let content = emailTemplate
      .replace(/{recruiter}/g, recruiterName)
      .replace(/{role}/g, jobTitle)
      .replace(/{company}/g, company);
    
    // Wrap in HTML email format
    return `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <p>${content.replace(/\n/g, '</p><p>')}</p>
          <p>Best regards,<br/><strong>${userName}</strong></p>
          <hr/>
          <p style="font-size: 12px; color: #666;">
            This is an automated application from InstaJob. 
            Sent on ${new Date().toLocaleDateString()}
          </p>
        </body>
      </html>
    `;
  }

  // Mock AI generation for Phase I development
  // In production: call openai.chat.completions.create() with proper prompt
  console.log(`[MOCK AI] Generating personalized email for ${jobTitle} at ${company}`);
  
  const mockContent = `Dear ${recruiterName},

I am writing to express my genuine interest in the ${jobTitle} position at ${company}. With my background and proven expertise, I am confident I can contribute significantly to your team.

I look forward to discussing how my skills align with your requirements.

Best regards,
${userName}`;

  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <p>${mockContent.replace(/\n/g, '</p><p>')}</p>
        <hr/>
        <p style="font-size: 12px; color: #666;">
          This is an automated application from InstaJob (AI-personalized). 
          Sent on ${new Date().toLocaleDateString()}
        </p>
      </body>
    </html>
  `;
}

// Cleanup function
export async function closeEmailQueue() {
  await emailQueue.close();
  await emailWorker.close();
  connection?.disconnect();
}
