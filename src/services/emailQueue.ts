import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import { sendTelegramNotification } from './telegramBot';

const prisma = new PrismaClient();

// Redis connection for BullMQ
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

// Email queue
export const emailQueue = new Queue('auto-apply-emails', { connection: connection as any });

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
        include: { user: true, job: true },
      });

      if (!application) {
        throw new Error(`Application not found for user ${userId}, job ${jobId}`);
      }

      // Generate professional application email
      const emailContent = generateApplicationEmail(
        application.user.fullName || 'User',
        application.job.title,
        application.job.company
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

// Helper: Generate professional application email
function generateApplicationEmail(userName: string, jobTitle: string, company: string): string {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <p>Dear Hiring Manager,</p>
        <p>I am writing to express my strong interest in the <strong>${jobTitle}</strong> position at <strong>${company}</strong>.</p>
        <p>With my professional experience and skills, I am confident that I can make a valuable contribution to your team.</p>
        <p>I would welcome the opportunity to discuss how my background aligns with the requirements of this role.</p>
        <p>Thank you for considering my application. I look forward to hearing from you.</p>
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

// Cleanup function
export async function closeEmailQueue() {
  await emailQueue.close();
  await emailWorker.close();
  connection.disconnect();
}
