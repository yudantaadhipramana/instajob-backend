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

export const jobScrapingWorker = workersEnabled && connection
  ? new Worker(
  'job-scraping',
  async (job) => {
    const { role, location, workType, limit } = job.data;
    console.log(`[JobScrapingWorker] Start: role="${role}" location="${location}" workType="${workType}"`);

    try {
      // Import waterfall dynamically to avoid circular deps
      const { scoutJobsWaterfall } = await import('./jobScoutWaterfall');
      
      const inserted = await scoutJobsWaterfall(role, limit || 10, { role, location, workType });
      
      console.log(`[JobScrapingWorker] Complete: ${inserted} jobs inserted`);
      return { success: true, inserted };
    } catch (err: any) {
      console.error('[JobScrapingWorker] Error:', err.message);
      throw err;
    }
  },
  { connection: connection as any, concurrency: 2 }
)
  : null as any;

jobScrapingWorker?.on('completed', (job: any, result: any) => {
  console.log(`[JobScrapingWorker] Job ${job.id} completed. Inserted ${result.inserted} jobs.`);
});

jobScrapingWorker?.on('failed', (job: any, err: any) => {
  console.error(`[JobScrapingWorker] Job ${job?.id} failed:`, err.message);
});
