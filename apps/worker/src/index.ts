import { openDatabase } from '@eventdesk/data';
import { recordEvent } from '@eventdesk/data/log';
import { processNextJob } from './process-job';

const db = openDatabase();
let stopping = false;
recordEvent('worker', 'worker_started');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopping = true; });
try {
  while (!stopping) {
    try { if (await processNextJob(db)) continue; }
    catch (error) { recordEvent('worker', 'poll_failed', { error: error instanceof Error ? error.message : String(error) }); }
    await new Promise(done => setTimeout(done, 700));
  }
} finally { await db.end(); }
