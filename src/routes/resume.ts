import * as fs from 'fs';
import * as path from 'path';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { openai } from '../services/openaiClient';

const prisma = new PrismaClient();
const { PDFParse } = require('pdf-parse');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'resumes');

export async function resumeRoutes(fastify: FastifyInstance) {
  // POST /api/user/resume/parse — save PDF to disk + parse with AI
  fastify.post('/api/user/resume/parse', { preHandler: [(fastify as any).authenticate] }, async (req: any, reply: any) => {
    try {
      const userId = req.user?.sub || req.user?.userId;
      if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      if (buffer.length > 5 * 1024 * 1024)
        return reply.code(400).send({ error: 'File too large (max 5MB)' });

      // Save PDF to disk
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const originalName = (data.filename || 'cv.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${userId}_${Date.now()}_${originalName}`;
      const filepath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      const resumeUrl = `/uploads/resumes/${filename}`;

      // Extract text
      let text = '';
      try {
        const result = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
        text = result.text;
      } catch {
        fs.unlinkSync(filepath);
        return reply.code(400).send({ error: 'Could not read PDF. Make sure it is a valid PDF file.' });
      }

      if (!text.trim()) {
        fs.unlinkSync(filepath);
        return reply.code(400).send({ error: 'PDF appears to be empty or image-only' });
      }

      // Parse with AI
      const completion = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `Extract profile data from this CV/resume text. Return ONLY valid JSON:
{
  "fullName": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "skills": ["array of technical skills"],
  "experience": [{"title": "Job Title", "company": "Company Name", "years": 2}],
  "education": [{"degree": "S1/S2/SMA/SMK/D3/etc", "field": "Jurusan"}],
  "certifications": [{"name": "Cert Name", "issuer": "Issuer"}],
  "portfolio": [{"title": "Project Name", "url": "https://..."}]
}
Rules: experience.years=integer. Return [] if section missing. No markdown, only JSON.`,
          },
          { role: 'user', content: text.slice(0, 8000) },
        ],
        max_tokens: 1500,
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

      // Persist resumeUrl
      await prisma.userProfile.upsert({
        where: { userId },
        update: { resumeUrl },
        create: { userId, resumeUrl },
      });

      return reply.send({ success: true, data: parsedData, resumeUrl });
    } catch (error) {
      console.error('Resume parse error:', error);
      return reply.code(500).send({ error: 'Failed to parse resume' });
    }
  });
}
