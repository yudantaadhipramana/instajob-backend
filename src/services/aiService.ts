import { PrismaClient } from '@prisma/client';
import { openai } from './openaiClient';

const prisma = new PrismaClient();

export const calculateMatchScore = async (userId: string, jobId: string): Promise<number> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!user || !user.profile || !job) return 0;

    const userSkillsArray = user.profile.skills ? JSON.parse(user.profile.skills) : [];
    const jobSkillsArray = job.requiredSkills ? JSON.parse(job.requiredSkills) : [];
    const prefs = user.profile.jobPreferences ? JSON.parse(user.profile.jobPreferences) : {};

    const prompt = `You are an expert HR recruiter. Score how well this candidate matches the job. Return ONLY a single integer 0-100.

Candidate: ${user.fullName}
Skills: ${(Array.isArray(userSkillsArray) ? userSkillsArray : []).join(', ') || 'none'}
Experience: ${user.profile.experience || 'none'}
Education: ${user.profile.education || 'none'}
Preferred locations: ${prefs.locations?.join(', ') || 'any'}
Salary expectation: ${prefs.salaryRange || 'any'}

Job: ${job.title} at ${(job as any).companyName || (job as any).company || ''}
Location: ${job.location}
Description: ${(job.description || '').substring(0, 500)}
Required skills: ${(Array.isArray(jobSkillsArray) ? jobSkillsArray : []).join(', ') || 'none'}`;

    const response = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 5,
      temperature: 0,
    });
    const score = Math.min(100, Math.max(0, parseInt(response.choices[0].message.content?.trim() || '0', 10)));

    await prisma.jobMatchScore.upsert({
      where: { userId_jobId: { userId, jobId } },
      update: { score },
      create: { userId, jobId, score },
    });
    console.log(`[AI] Match score ${userId}/${jobId}: ${score}`);
    return score;
  } catch (error: any) {
    console.error('Match score error:', error.message);
    return 0;
  }
};

export const getJobRecommendations = async (userId: string, limit: number = 10) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!user || !user.profile) return [];
  const prefs = user.profile.jobPreferences ? JSON.parse(user.profile.jobPreferences) : {};
  const industries = prefs.industries || [];
  return prisma.job.findMany({
    where: {
      OR: [{ industry: { in: industries } }],
      NOT: { applications: { some: { userId } } },
    },
    take: limit,
    orderBy: { postedAt: 'desc' },
  });
};
