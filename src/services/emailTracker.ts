import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';

const prisma = new PrismaClient();

/**
 * Poll Gmail threads untuk detect reply
 * Return count aplikasi yg dapat reply baru
 */
export async function pollGmailReplies(userId: string): Promise<number> {
  try {
    const integration = await prisma.gmailIntegration.findUnique({ where: { userId } });
    if (!integration?.refreshToken || !integration.isConnected) {
      console.warn(`[EmailTracker] Skip ${userId}: no Gmail token`);
      return 0;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: integration.refreshToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch aplikasi user yg punya gmailThreadId
    const applications = await prisma.application.findMany({
      where: { userId, gmailThreadId: { not: null } },
      select: { id: true, gmailThreadId: true }
    });

    if (applications.length === 0) return 0;

    let replyCount = 0;

    for (const app of applications) {
      try {
        const thread = await gmail.users.threads.get({
          userId: 'me',
          id: app.gmailThreadId!,
          format: 'metadata'
        });

        const messageCount = thread.data.messages?.length || 0;

        // Kalau > 1 message = ada reply (original email kita = 1 message)
        if (messageCount > 1) {
          // Cek apakah sudah log event 'replied'
          const existingReply = await prisma.applicationEvent.findFirst({
            where: {
              applicationId: app.id,
              eventType: 'replied'
            }
          });

          if (!existingReply) {
            await prisma.applicationEvent.create({
              data: {
                applicationId: app.id,
                eventType: 'replied'
              }
            });
            console.log(`[EmailTracker] Reply detected: app ${app.id}`);
            replyCount++;
          }
        }
      } catch (threadErr: any) {
        // Thread mungkin dihapus atau token expired
        console.warn(`[EmailTracker] Thread ${app.gmailThreadId} error:`, threadErr.message);
      }
    }

    return replyCount;
  } catch (error: any) {
    console.error(`[EmailTracker] pollGmailReplies error for ${userId}:`, error.message);
    return 0;
  }
}

/**
 * Poll semua user yg connect Gmail
 * Return total reply baru
 */
export async function pollAllUsers(): Promise<number> {
  const integrations = await prisma.gmailIntegration.findMany({
    where: { isConnected: true },
    select: { userId: true }
  });

  let totalReplies = 0;
  for (const { userId } of integrations) {
    const count = await pollGmailReplies(userId);
    totalReplies += count;
  }

  console.log(`[EmailTracker] Polled ${integrations.length} users, ${totalReplies} new replies`);
  return totalReplies;
}
