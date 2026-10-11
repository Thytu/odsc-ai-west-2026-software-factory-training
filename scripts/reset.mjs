import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@eventdesk/data';
import { startDatabase } from './postgres.mjs';

if (process.env.VERCEL) throw new Error('Reset is available only for this checkout’s local database.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = resolve(root, '.data/dev.lock');
await mkdir(resolve(root, '.data'), { recursive: true });
async function claimLock() {
  const handle = await open(lock, 'wx');
  await handle.writeFile(String(process.pid));
  await handle.close();
}
try { await claimLock(); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const pid = Number(await readFile(lock, 'utf8'));
  try { process.kill(pid, 0); }
  catch (cause) {
    if (cause.code !== 'ESRCH') throw cause;
    await rm(lock);
    await claimLock();
  }
  if (pid !== process.pid && Number(await readFile(lock, 'utf8')) !== process.pid) {
    throw new Error('Stop pnpm dev before resetting this checkout’s data.');
  }
}
let server;
let db;
try {
  process.env.EVENTDESK_LOCAL_DATABASE = '1';
  server = await startDatabase(root);
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { cwd: root, stdio: 'inherit' });
  db = openDatabase();
  await db.query('TRUNCATE audit_events, outbox, jobs, registrations, attendees, sessions CASCADE');
  await db.end();
  db = undefined;
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { cwd: root, stdio: 'inherit' });
  console.log('Local demo data reset. Start the app with pnpm dev.');
} finally {
  await db?.end();
  await server?.stop();
  await rm(lock, { force: true });
}
