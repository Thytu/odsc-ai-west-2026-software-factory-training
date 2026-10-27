import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { localDataPath } from './paths';

export function openDatabase(options: { migration?: boolean } = {}) {
  const connectionString = options.migration
    ? process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL
    : process.env.DATABASE_URL;
  let config: pg.PoolConfig;
  if (process.env.EVENTDESK_LOCAL_DATABASE === '1') {
    config = JSON.parse(readFileSync(localDataPath('database.json'), 'utf8'));
  } else if (connectionString) {
    const url = new URL(connectionString);
    if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) url.searchParams.set('sslmode', 'verify-full');
    config = { connectionString: url.toString() };
  } else {
    try { config = JSON.parse(readFileSync(localDataPath('database.json'), 'utf8')); }
    catch { throw new Error('No database is running for this checkout. Start it with pnpm dev.'); }
  }
  const pool = new pg.Pool({ ...config, max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  pool.on('error', error => console.error('Database connection closed:', error.message));
  if (process.env.VERCEL) attachDatabasePool(pool);
  return pool;
}

export type Database = pg.Pool | pg.PoolClient;

export async function transaction<T>(db: pg.Pool, action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function listSessions(db: Database) {
  return (await db.query(`
    SELECT s.*, COUNT(r.id)::integer AS registration_count
    FROM sessions s LEFT JOIN registrations r ON r.session_id = s.id AND r.status = 'registered'
    GROUP BY s.id ORDER BY s.starts_at
  `)).rows;
}

export async function getSessionDetail(db: Database, sessionId: string) {
  const session = (await db.query(`
    SELECT s.*, (SELECT COUNT(*)::integer FROM outbox o WHERE o.session_id = s.id AND o.kind = 'session_reminder') AS reminder_count
    FROM sessions s WHERE s.id = $1
  `, [sessionId])).rows[0];
  if (!session) return null;
  const registrations = (await db.query(`
    SELECT a.id, a.name, a.email, a.company, r.status
    FROM registrations r JOIN attendees a ON a.id = r.attendee_id
    WHERE r.session_id = $1 ORDER BY a.name
  `, [sessionId])).rows;
  return { ...session, registrations };
}

export async function getReminderSession(db: Database, sessionId: string) {
  return ((await db.query('SELECT id, title, room, starts_at FROM sessions WHERE id = $1', [sessionId])).rows[0] ?? null) as
    { id: string; title: string; room: string; starts_at: string } | null;
}

export async function listReminderRecipients(db: Database, sessionId: string) {
  return (await db.query("SELECT a.id FROM registrations r JOIN attendees a ON a.id = r.attendee_id WHERE r.session_id = $1 AND r.status = 'registered'", [sessionId])).rows as Array<{ id: string }>;
}

export async function listAttendees(db: Database) {
  return (await db.query('SELECT * FROM attendees ORDER BY name')).rows;
}

export async function getAttendeeSchedule(db: Database, attendeeId: string) {
  return (await db.query(`
    SELECT s.*, r.status AS registration_status FROM registrations r
    JOIN sessions s ON s.id = r.session_id
    WHERE r.attendee_id = $1 ORDER BY s.starts_at
  `, [attendeeId])).rows;
}

export async function getAttendeeNotifications(db: Database, attendeeId: string) {
  return (await db.query(`
    SELECT o.*, s.title AS session_title FROM outbox o
    JOIN sessions s ON s.id = o.session_id
    WHERE o.attendee_id = $1 ORDER BY o.created_at DESC
  `, [attendeeId])).rows;
}

export async function listActivity(db: Database) {
  return (await db.query(`
    SELECT e.*, s.title AS session_title FROM audit_events e
    JOIN sessions s ON s.id = e.session_id
    ORDER BY e.created_at DESC LIMIT 20
  `)).rows;
}

export async function changeRoom(db: pg.Pool, sessionId: string, room: string, actor: string, requestId?: string) {
  return transaction(db, async client => {
    const session = (await client.query('SELECT id, room FROM sessions WHERE id = $1 FOR UPDATE', [sessionId])).rows[0];
    if (!session) return null;
    const changed = session.room !== room;
    if (changed) {
      await client.query('UPDATE sessions SET room = $1 WHERE id = $2', [room, sessionId]);
      await client.query('INSERT INTO audit_events (id, kind, session_id, request_id, actor, details_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [randomUUID(), 'room_changed', sessionId, requestId ?? null, actor, JSON.stringify({ before: session.room, after: room }), new Date().toISOString()]);
    }
    return { before: session.room, after: room, changed };
  });
}

export async function registerAttendee(db: pg.Pool, sessionId: string, attendeeId: string) {
  return transaction(db, async client => {
    const session = (await client.query('SELECT id, capacity FROM sessions WHERE id = $1 FOR UPDATE', [sessionId])).rows[0];
    const attendee = (await client.query('SELECT id FROM attendees WHERE id = $1', [attendeeId])).rows[0];
    if (!session || !attendee) return { error: 'not_found' as const };
    const existing = (await client.query('SELECT id FROM registrations WHERE session_id = $1 AND attendee_id = $2', [sessionId, attendeeId])).rows[0];
    if (existing) return { created: false };
    const count = (await client.query("SELECT COUNT(*)::integer AS count FROM registrations WHERE session_id = $1 AND status = 'registered'", [sessionId])).rows[0];
    if (count.count >= session.capacity) return { error: 'full' as const };
    const result = await client.query('INSERT INTO registrations (id, session_id, attendee_id, status, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, attendee_id) DO NOTHING',
      [randomUUID(), sessionId, attendeeId, 'registered', new Date().toISOString()]);
    return { created: (result.rowCount ?? 0) > 0 };
  });
}

export async function enqueueJob(db: Database, kind: string, payload: any, runAt = new Date().toISOString()) {
  const id = randomUUID();
  await db.query('INSERT INTO jobs (id, kind, payload_json, run_at, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, kind, JSON.stringify(payload), runAt, new Date().toISOString()]);
  return id;
}

export async function getJobStatus(db: Database, jobId: string) {
  return ((await db.query('SELECT id, status FROM jobs WHERE id = $1', [jobId])).rows[0] ?? null) as { id: string; status: string } | null;
}

export async function claimJob(db: Database, jobId?: string) {
  const job = (await db.query(jobId
    ? "SELECT * FROM jobs WHERE id = $1 AND status IN ('pending', 'failed') AND run_at <= $2 FOR UPDATE SKIP LOCKED"
    : "SELECT * FROM jobs WHERE status = 'pending' AND run_at <= $1 ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED",
  jobId ? [jobId, new Date().toISOString()] : [new Date().toISOString()])).rows[0];
  if (job) await db.query("UPDATE jobs SET status = 'processing' WHERE id = $1", [job.id]);
  return job ?? null;
}

export async function completeJob(db: Database, jobId: string) {
  await db.query("UPDATE jobs SET status = 'completed', completed_at = $1 WHERE id = $2", [new Date().toISOString(), jobId]);
}

export async function failJob(db: Database, jobId: string) {
  await db.query("UPDATE jobs SET status = 'failed', completed_at = $1 WHERE id = $2 AND status <> 'completed'", [new Date().toISOString(), jobId]);
}

export async function insertOutbox(db: Database, jobId: string, sessionId: string, attendeeId: string, kind: string, subject: string, body: string) {
  await db.query('INSERT INTO outbox (id, attendee_id, session_id, job_id, kind, subject, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (job_id, attendee_id) DO NOTHING',
    [randomUUID(), attendeeId, sessionId, jobId, kind, subject, body, new Date().toISOString()]);
}
