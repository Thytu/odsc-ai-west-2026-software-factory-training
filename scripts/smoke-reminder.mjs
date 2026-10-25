import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { startDatabase } from './postgres.mjs';

const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'eventdesk-reminder-'));
const server = await startDatabase(root);
let db;
try {
  const config = JSON.parse(await readFile(join(root, '.data/database.json'), 'utf8'));
  const url = new URL('postgresql://localhost/eventdesk');
  url.username = config.user;
  url.password = config.password;
  if (config.host.startsWith('/')) url.searchParams.set('host', config.host);
  else { url.hostname = config.host; url.port = String(config.port); }
  process.env.EVENTDESK_LOCAL_DATABASE = '0';
  process.env.DATABASE_URL = url.toString();
  process.env.DATABASE_URL_UNPOOLED = url.toString();
  process.env.EVENTDESK_LOG_PATH = join(root, '.data/events.jsonl');
  delete process.env.VERCEL;
  for (const script of ['migrate', 'seed']) await execute(process.execPath, ['--import', 'tsx', `scripts/${script}.ts`], { env: process.env });
  const data = await import('@eventdesk/data');
  const { processNextJob } = await import('../apps/worker/src/process-job');
  db = data.openDatabase();
  const count = async (sessionId) => (await db.query("SELECT COUNT(*)::integer AS count FROM outbox WHERE session_id = $1 AND kind = 'session_reminder'", [sessionId])).rows[0].count;
  assert.equal(await count('session-101'), 0);
  const first = await processNextJob(db);
  assert.deepEqual(first?.recipients.sort(), ['attendee-101', 'attendee-102', 'attendee-103']);
  assert.equal(await count('session-101'), 3);
  assert.equal(await count('session-102'), 0);
  await processNextJob(db, first.jobId);
  assert.equal(await count('session-101'), 3);
  await data.insertOutbox(db, first.jobId, 'session-101', 'attendee-104', 'room_change', 'Room changed', 'A different notification kind');
  assert.equal(await count('session-101'), 3);
  await data.changeRoom(db, 'session-101', 'New room', 'smoke');
  const next = await data.enqueueJob(db, 'session_reminder', { sessionId: 'session-101' });
  await processNextJob(db, next);
  assert.equal(await count('session-101'), 6);
  assert.ok((await data.getAttendeeNotifications(db, 'attendee-101')).some(row => row.body.includes('New room')));
  console.log('Reminder count, recipients, updated room, duplicate delivery, and notification-kind filtering verified.');
} finally {
  await db?.end();
  await server.stop();
  await rm(root, { recursive: true, force: true });
}
