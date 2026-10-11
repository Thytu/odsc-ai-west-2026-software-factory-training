import { openDatabase } from '@eventdesk/data';
import { processNextJob } from '../apps/worker/src/process-job';

const db = openDatabase();
try {
  for (let count = 0; count < 100; count++) {
    if (!await processNextJob(db)) break;
    if (count === 99) throw new Error('Preview initialization exceeded its job limit.');
  }
} finally { await db.end(); }
