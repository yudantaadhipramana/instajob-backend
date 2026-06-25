"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobScrapingWorker = exports.jobScrapingQueue = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const connection = new ioredis_1.default({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
});
exports.jobScrapingQueue = new bullmq_1.Queue('job-scraping', { connection: connection });
exports.jobScrapingWorker = new bullmq_1.Worker('job-scraping', async (job) => {
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
    }
    catch (err) {
        console.error('Job scraping db error:', err);
        throw err;
    }
}, { connection: connection, concurrency: 1 });
exports.jobScrapingWorker.on('completed', (job, result) => {
    console.log(`Job scraping job ${job.id} completed. Found ${result.count} new jobs.`);
});
exports.jobScrapingWorker.on('failed', (job, err) => {
    console.error(`Job scraping job ${job?.id} failed:`, err.message);
});
