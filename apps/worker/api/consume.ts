import { QueueClient } from '@vercel/queue';
import { openDatabase } from '@eventdesk/data';
import { processNextJob } from '../src/process-job';

const db = openDatabase();
const queue = new QueueClient({ region: 'iad1' });
export const POST = queue.handleCallback(async (message: { jobId: string }) => {
  if (!message || typeof message.jobId !== 'string') throw new Error('Missing job ID');
  await processNextJob(db, message.jobId);
}, {
  retry: (_error, metadata) => metadata.deliveryCount >= 5
    ? { acknowledge: true }
    : { afterSeconds: Math.min(60, 2 ** metadata.deliveryCount) },
});
