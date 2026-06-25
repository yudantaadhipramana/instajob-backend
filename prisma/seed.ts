import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Create a Sample User
  const user = await prisma.user.upsert({
    where: { email: 'danta@instajob.app' },
    update: {},
    create: {
      email: 'danta@instajob.app',
      fullName: 'Yudanta Adhipramana',
      referralCode: 'DANTA-PRO-01',
      subscriptionType: 'pro',
    },
  });

  // Create Sample Jobs (Scout Results)
  const jobs = [
    {
      title: 'Senior Frontend Developer',
      company: 'Google Indonesia',
      location: 'Jakarta (Remote)',
      source: 'LinkedIn',
      description: 'Expert in React/Next.js and Tailwind CSS...',
      applyUrl: 'https://google.com/careers',
      emailContact: 'hr@google.com',
    },
    {
      title: 'Fullstack Engineer',
      company: 'Gojek',
      location: 'Jakarta',
      source: 'JobStreet',
      description: 'Experience with Node.js and Go...',
      applyUrl: 'https://gojek.io/careers',
    },
    {
      title: 'Data Analyst',
      company: 'Shopee',
      location: 'Singapore / Remote',
      source: 'LinkedIn',
      description: 'SQL and Python expert needed...',
      applyUrl: 'https://careers.shopee.sg',
    }
  ];

  for (const job of jobs) {
    const createdJob = await prisma.job.create({ data: job });
    
    // Create Application Trackers for the user
    await prisma.application.create({
      data: {
        userId: user.id,
        jobId: createdJob.id,
        matchScore: Math.floor(Math.random() * 20) + 80, // 80-100
        appliedVia: 'auto_mail',
        status: 'discovered',
      }
    });
  }

  console.log('Database Seeded Successfully! 🌱');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
