import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const workersEnabled = process.env.ENABLE_WORKERS !== 'false';
const connection = workersEnabled ? new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
}) : null;
if (connection) connection.on('error', () => {});

export const jobScrapingQueue = workersEnabled && connection
  ? new Queue('job-scraping', { connection: connection as any })
  : null as any;

export const jobScrapingWorker = new Worker(
  'job-scraping',
  async (job) => {
    const { source, query } = job.data;
    console.log(`Scraping jobs from ${source} for query "${query}"`);

    // In a real app, this would use a library like Playwright or Cheerio
    // to scrape jobs from LinkedIn, Indeed, etc.

    // Mock job scraping
    const mockJobs = [
      {
        title: `Software Engineer (${source})`,
        description: `Exciting role for a developer at a top tech company. Query: ${query}`,
        company: 'Tech Corp',
        location: 'Remote',
        salaryMin: 80000,
        salaryMax: 120000,
        remote: true
      },
      {
        title: `Product Manager (${source})`,
        description: `Lead product strategy and execution. Query: ${query}`,
        company: 'Innovate Inc.',
        location: 'New York, NY',
        salaryMin: 100000,
        salaryMax: 150000,
        remote: false
      }
    ];

    try {
      await prisma.job.createMany({
        data: mockJobs,
        skipDuplicates: true
      });
      
      console.log(`Saved ${mockJobs.length} new jobs from ${source}`);
      return { success: true, count: mockJobs.length };
    } catch (err) {
      console.error('Job scraping db error:', err);
      throw err;
    }
  },
  { connection: connection as any, concurrency: 1 }
);

jobScrapingWorker.on('completed', (job, result) => {
  console.log(`Job scraping job ${job.id} completed. Found ${result.count} new jobs.`);
});

jobScrapingWorker.on('failed', (job, err) => {
  console.error(`Job scraping job ${job?.id} failed:`, err.message);
});
