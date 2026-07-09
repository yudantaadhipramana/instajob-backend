const IORedis = require('ioredis');
const { Queue } = require('bullmq');

console.log('Connecting with host=127.0.0.1...');
const connection = new IORedis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null,
});

connection.on('connect', () => console.log('IORedis: connected'));
connection.on('ready', () => console.log('IORedis: ready'));
connection.on('error', (e) => console.log('IORedis error:', e.message));

const q = new Queue('test-queue', { connection });

(async () => {
  console.log('Adding job...');
  const start = Date.now();
  try {
    const job = await q.add('test', { foo: 'bar' });
    console.log('Job added in', Date.now() - start, 'ms, id:', job.id);
  } catch (e) {
    console.log('Add failed after', Date.now() - start, 'ms:', e.message);
  }
  process.exit(0);
})();
