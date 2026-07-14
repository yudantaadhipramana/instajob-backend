import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { openai } from '../services/openaiClient';

const prisma = new PrismaClient();
const { PDFParse } = require('pdf-parse');

export async function resumeRoutes(fastify: FastifyInstance) {
  // POST /api/user/resume/parse — upload PDF + parse with OpenAI
  fastify.post(
    '/api/user/resume/parse',
    { preHandler: [(fastify as any).authenticate] },
    async (req: any, reply: any) => {
      try {
        const userId = req.user?.sub || req.user?.userId;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

        const data = await req.file();
        if (!data) {
          return reply.code(400).send({ error: 'No file uploaded' });
        }

        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        if (buffer.length > 5 * 1024 * 1024) {
          return reply.code(400).send({ error: 'File too large (max 5MB)' });
        }

        // Extract text from PDF
        let text = '';
        try {
          const parser = new PDFParse({ data: new Uint8Array(buffer) });
          const result = await parser.getText();
          text = result.text;
          await parser.destroy();
        } catch (pdfErr: any) {
          console.error('PDF parse error:', pdfErr?.message || pdfErr);
          return reply.code(400).send({ error: 'Could not read PDF. Make sure it is a valid PDF file.' });
        }

        if (!text.trim()) {
          return reply.code(400).send({ error: 'PDF appears to be empty or image-only' });
        }

        // Parse with OpenAI
        const completion = await openai.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `Extract profile data from this CV/resume text. Return ONLY valid JSON with these exact keys:
{
  "fullName": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "bio": "2-3 sentence professional summary or null",
  "experience": "summary of work experience or null",
  "education": "highest degree and institution or null",
  "skills": ["array", "of", "skills"]
}
No markdown, no explanation, just JSON.`,
            },
            {
              role: 'user',
              content: text.slice(0, 8000),
            },
          ],
          max_tokens: 1000,
          temperature: 0,
        });

        const raw = completion.choices[0]?.message?.content ?? '{}';
        let parsedData: Record<string, unknown>;
        try {
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
          parsedData = JSON.parse(cleaned);
        } catch {
          return reply.code(500).send({ error: 'Failed to parse AI response' });
        }

        // Save resumeUrl marker to UserProfile
        const safeFilename = `${userId}_${Date.now()}_parsed.pdf`;
        await prisma.userProfile.upsert({
          where: { userId },
          update: { resumeUrl: `/uploads/resumes/${safeFilename}` },
          create: { userId, resumeUrl: `/uploads/resumes/${safeFilename}` },
        });

        return reply.send({ success: true, data: parsedData });
      } catch (error) {
        console.error('Resume parse error:', error);
        return reply.code(500).send({ error: 'Failed to parse resume' });
      }
    }
  );
}
