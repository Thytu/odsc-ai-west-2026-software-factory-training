import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { localDataPath } from '@eventdesk/data/paths';
import { openDatabase } from '@eventdesk/data';

if (process.env.VERCEL) throw new Error('Reset is available only for this checkout’s local database.');
const config = JSON.parse(await readFile(localDataPath('database.json'), 'utf8'));
if (!config.host?.startsWith('/') && config.host !== '127.0.0.1') throw new Error('Expected a local database.');
process.env.EVENTDESK_LOCAL_DATABASE = '1';
const db = openDatabase();
try {
  await db.query('TRUNCATE audit_events, outbox, jobs, registrations, attendees, sessions CASCADE');
} finally { await db.end(); }
execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['seed'], { stdio: 'inherit' });
