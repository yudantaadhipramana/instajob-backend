"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailWorker = exports.emailQueue = void 0;
exports.closeEmailQueue = closeEmailQueue;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const client_1 = require("@prisma/client");
const nodemailer_1 = __importDefault(require("nodemailer"));
const prisma = new client_1.PrismaClient();
// Redis connection for BullMQ
const connection = new ioredis_1.default({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
});
// Email queue
exports.emailQueue = new bullmq_1.Queue('auto-apply-emails', { connection: connection });
// Email transporter (mock - replace with real SMTP in production)
const emailTransporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
// Worker: Process email queue jobs
exports.emailWorker = new bullmq_1.Worker('auto-apply-emails', async (job) => {
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
        const emailContent = generateApplicationEmail(application.user.fullName || 'User', application.job.title, application.job.company);
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
    }
    catch (error) {
        console.error('Email queue error:', error);
        throw error;
    }
}, { connection: connection, concurrency: 3 });
// Event handlers
exports.emailWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed successfully`);
});
exports.emailWorker.on('failed', async (job, err) => {
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
function generateApplicationEmail(userName, jobTitle, company) {
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
async function closeEmailQueue() {
    await exports.emailQueue.close();
    await exports.emailWorker.close();
    connection.disconnect();
}
