import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/integrations/gmail/callback'
);

/**
 * Generate Google OAuth URL for Gmail access
 */
export function getGoogleAuthUrl(userId: string): string {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: userId, // Pass userId in state for callback
    prompt: 'consent'
  });
}

/**
 * Exchange authorization code for tokens and save to DB
 */
export async function handleGmailCallback(code: string, userId: string) {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user email
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress!;

    // Save or update integration
    await prisma.gmailIntegration.upsert({
      where: { userId },
      create: {
        userId,
        gmailEmail: emailAddress,
        refreshToken: tokens.refresh_token || null,
        isConnected: true,
        lastSyncAt: new Date()
      },
      update: {
        gmailEmail: emailAddress,
        refreshToken: tokens.refresh_token || undefined,
        isConnected: true,
        lastSyncAt: new Date()
      }
    });

    return { success: true, email: emailAddress };
  } catch (error: any) {
    console.error('Gmail callback error:', error);
    throw new Error(`Failed to connect Gmail: ${error.message}`);
  }
}

/**
 * Sync Gmail inbox for a user (called periodically)
 */
export async function syncGmailInbox(userId: string) {
  try {
    const integration = await prisma.gmailIntegration.findUnique({
      where: { userId }
    });

    if (!integration || !integration.isConnected || !integration.refreshToken) {
      throw new Error('Gmail not connected or refresh token missing');
    }

    oauth2Client.setCredentials({
      refresh_token: integration.refreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Get messages from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${Math.floor(sevenDaysAgo.getTime() / 1000)} in:inbox`,
      maxResults: 50
    });

    if (!response.data.messages) {
      return { newEmails: 0 };
    }

    let newCount = 0;

    for (const message of response.data.messages) {
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: message.id!,
        format: 'full'
      });

      const headers = msgData.data.payload?.headers || [];
      const fromHeader = headers.find(h => h.name === 'From');
      const subjectHeader = headers.find(h => h.name === 'Subject');
      
      const fromEmail = fromHeader?.value || 'unknown';
      const subject = subjectHeader?.value || '(no subject)';
      
      // Extract plain text preview
      let preview = '';
      const parts = msgData.data.payload?.parts || [];
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          preview = Buffer.from(part.body.data, 'base64').toString('utf-8').substring(0, 200);
          break;
        }
      }

      // Classify email type (simple heuristic)
      let emailType = 'OTHER';
      const subjectLower = subject.toLowerCase();
      if (subjectLower.includes('interview') || subjectLower.includes('wawancara')) {
        emailType = 'INTERVIEW';
      } else if (subjectLower.includes('reject') || subjectLower.includes('sorry') || subjectLower.includes('unfortunately')) {
        emailType = 'REJECT';
      } else if (subjectLower.includes('re:') || subjectLower.includes('reply')) {
        emailType = 'REPLY';
      }

      // Check if already exists
      const existing = await prisma.emailNotification.findFirst({
        where: {
          userId,
          fromEmail,
          subject
        }
      });

      if (!existing) {
        await prisma.emailNotification.create({
          data: {
            userId,
            fromEmail,
            subject,
            preview,
            type: emailType,
            notifiedToTelegram: false
          }
        });
        newCount++;
      }
    }

    // Update lastSyncAt
    await prisma.gmailIntegration.update({
      where: { userId },
      data: { lastSyncAt: new Date() }
    });

    return { newEmails: newCount };
  } catch (error: any) {
    console.error('Gmail sync error:', error);
    throw new Error(`Gmail sync failed: ${error.message}`);
  }
}

/**
 * Disconnect Gmail integration
 */
export async function disconnectGmail(userId: string) {
  await prisma.gmailIntegration.update({
    where: { userId },
    data: {
      isConnected: false,
      refreshToken: null
    }
  });
}

/**
 * Send email via user's Gmail (Phase N: auto-send)
 */
export async function sendEmailViaGmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  resumeUrl?: string | null
): Promise<{ messageId: string }> {
  const integration = await prisma.gmailIntegration.findUnique({ where: { userId } });

  if (!integration || !integration.isConnected || !integration.refreshToken) {
    throw new Error('Gmail not connected. Please reconnect via /api/integrations/gmail/auth-url');
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/integrations/gmail/callback'
  );
  client.setCredentials({ refresh_token: integration.refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: client });
  const from = integration.gmailEmail;
  const boundary = `boundary_${Date.now()}`;

  // Try to read CV file if resumeUrl is a local path
  let cvBuffer: Buffer | null = null;
  let cvFilename = 'CV.pdf';
  if (resumeUrl && resumeUrl.startsWith('/uploads/')) {
    const cvPath = path.join(process.cwd(), resumeUrl);
    if (fs.existsSync(cvPath)) {
      cvBuffer = fs.readFileSync(cvPath);
      cvFilename = path.basename(cvPath);
    }
  }

  let raw: string;
  if (cvBuffer) {
    // MIME multipart with CV attachment
    const parts = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      body,
      '',
      `--${boundary}`,
      `Content-Type: application/pdf; name="${cvFilename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${cvFilename}"`,
      '',
      cvBuffer.toString('base64'),
      '',
      `--${boundary}--`,
    ];
    raw = Buffer.from(parts.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } else {
    // Plain HTML email
    const parts = [
      `From: ${from}`, `To: ${to}`, `Subject: ${subject}`,
      'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body,
    ];
    raw = Buffer.from(parts.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { messageId: result.data.id! };
}

/**
 * Get Gmail connection status for a user
 */
export async function getGmailStatus(userId: string) {
  const integration = await prisma.gmailIntegration.findUnique({ where: { userId } });
  return {
    isConnected: integration?.isConnected ?? false,
    email: integration?.isConnected ? integration.gmailEmail : null,
    lastSyncAt: integration?.lastSyncAt ?? null
  };
}
