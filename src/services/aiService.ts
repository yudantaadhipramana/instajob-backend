import { PrismaClient } from '@prisma/client';
import { openai } from './openaiClient'; // Assuming we have an OpenAI client setup

const prisma = new PrismaClient();

/**
 * Calculates a matching score between a user's CV/profile and a job description.
 * @param userId - The ID of the user.
 * @param jobId - The ID of the job.
 * @returns A score from 0 to 100.
 */
export const calculateMatchScore = async (userId: string, jobId: string): Promise<number> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    const job = await prisma.job.findUnique({ where: { id: jobId } });

    if (!user || !user.profile || !job) {
      console.error(`User, profile, or job not found for user ${userId} and job ${jobId}`);
      return 0;
    }

    const prefs = user.profile.jobPreferences ? JSON.parse(user.profile.jobPreferences) : {};
    
    const userSkillsArray = user.profile.skills ? JSON.parse(user.profile.skills) : [];
    const userSummary = `
      Full Name: ${user.fullName}
      Skills: ${(Array.isArray(userSkillsArray) ? userSkillsArray : []).join(', ') || 'Not specified'}
      Experience: ${user.profile.experience || 'Not specified'}
      Education: ${user.profile.education || 'Not specified'}
      Preferences: Looking for roles in ${prefs.industries?.join(', ') || 'any industry'}, 
                   located in ${prefs.locations?.join(', ') || 'any location'}.
                   Salary expectation: ${prefs.salaryRange || 'any'}.
    `;

    const jobSkillsArray = job.requiredSkills ? JSON.parse(job.requiredSkills) : [];
    const jobSummary = `
      Job Title: ${job.title}
      Company: ${job.companyName}
      Location: ${job.location}
      Description: ${job.description}
      Required Skills: ${(Array.isArray(jobSkillsArray) ? jobSkillsArray : []).join(', ') || 'Not specified'}
    `;

    const prompt = `
      You are an expert HR recruitment agent. Your task is to calculate a "match score" from 0 to 100 
      that represents how well a candidate's profile matches a job description.

      Analyze the following candidate profile and job description. Consider skills, experience, education, and preferences.
      - A score of 0-40 is a poor match.
      - A score of 41-70 is a decent match, but with some gaps.
      - A score of 71-90 is a strong match.
      - A score of 91-100 is a perfect match.

      Candidate Profile:
      ---
      ${userSummary}
      ---

      Job Description:
      ---
      ${jobSummary}
      ---

      Based on your analysis, provide ONLY a single integer score from 0 to 100. Do not include any other text or explanation.
    `;

    // Mocking the AI response for now to avoid actual API calls during development.
    // In production, this would be an actual OpenAI call.
    // const response = await openai.chat.completions.create({
    //   model: "gpt-3.5-turbo",
    //   messages: [{ role: "user", content: prompt }],
    //   max_tokens: 5,
    // });
    // const score = parseInt(response.choices[0].message.content?.trim() || '0', 10);
    
    // Using a deterministic "mock" score based on shared skills for now
    const userSkillsParsed = user.profile.skills ? JSON.parse(user.profile.skills) : [];
    const jobSkillsParsed = job.requiredSkills ? JSON.parse(job.requiredSkills) : [];
    const userSkills = new Set((Array.isArray(userSkillsParsed) ? userSkillsParsed : []).map((s: string) => s.toLowerCase()));
    const jobSkills = new Set((Array.isArray(jobSkillsParsed) ? jobSkillsParsed : []).map((s: string) => s.toLowerCase()));
    const intersection = new Set([...userSkills].filter(skill => jobSkills.has(skill)));
    
    let mockScore = 0;
    if (jobSkills.size > 0) {
        mockScore = Math.round((intersection.size / jobSkills.size) * 100);
    }
    
    // Add some randomness to make it feel less deterministic
    mockScore = Math.min(100, mockScore + Math.floor(Math.random() * 10));

    console.log(`[AI MOCK] Match score for user ${userId} and job ${jobId}: ${mockScore}`);

    // Store the score in the database
    await prisma.jobMatchScore.upsert({
        where: { userId_jobId: { userId, jobId } },
        update: { score: mockScore },
        create: { userId, jobId, score: mockScore },
    });

    return mockScore;
  } catch (error) {
    console.error('Error calculating match score:', error);
    return 0; // Return 0 on error
  }
};


/**
 * Generates job recommendations for a user based on their profile.
 * @param userId - The ID of the user.
 * @returns A list of recommended jobs.
 */
export const getJobRecommendations = async (userId: string, limit: number = 10) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
    });

    if (!user || !user.profile) {
        return [];
    }

    const prefs = user.profile.jobPreferences ? JSON.parse(user.profile.jobPreferences) : {};
    const industries = prefs.industries || [];

    // For now, simple recommendation based on user's preferred industries and skills
    const recommendedJobs = await prisma.job.findMany({
        where: {
            OR: [
                { industry: { in: industries } },
                { requiredSkills: { hasSome: user.profile.skills || [] } },
            ],
            // Exclude jobs the user has already applied to
            NOT: {
                applications: { some: { userId } }
            },
        },
        take: limit,
        orderBy: {
            postedDate: 'desc',
        },
    });

    // In a real scenario, we would calculate match scores for these and sort by score.
    // For now, we return them as is.
    return recommendedJobs;
};
