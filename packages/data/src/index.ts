import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { localDataPath } from './paths';

export const databasePath = process.env.EVENTDESK_DB_PATH ?? localDataPath('eventdesk.sqlite');

export function openDatabase() {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      track TEXT NOT NULL,
      summary TEXT NOT NULL,
      room TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      attendee_id TEXT NOT NULL REFERENCES attendees(id),
      status TEXT NOT NULL DEFAULT 'registered',
      created_at TEXT NOT NULL,
      UNIQUE(session_id, attendee_id)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      run_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      attendee_id TEXT NOT NULL REFERENCES attendees(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      job_id TEXT NOT NULL REFERENCES jobs(id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(job_id, attendee_id)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      request_id TEXT,
      actor TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export type Database = ReturnType<typeof openDatabase>;

export function listSessions(db: Database) {
  return db.prepare(`
    SELECT s.*, COUNT(r.id) AS registration_count
    FROM sessions s LEFT JOIN registrations r ON r.session_id = s.id AND r.status = 'registered'
    GROUP BY s.id ORDER BY s.starts_at
  `).all();
}

export function getSession(db: Database, id: string) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return null;
  const registrations = db.prepare(`
    SELECT a.id, a.name, a.email, a.company, r.status
    FROM registrations r JOIN attendees a ON a.id = r.attendee_id
    WHERE r.session_id = ? ORDER BY a.name
  `).all(id);
  return { ...session, registrations };
}

export function listAttendees(db: Database) {
  return db.prepare('SELECT * FROM attendees ORDER BY name').all();
}

export function getAttendeeSchedule(db: Database, attendeeId: string) {
  return db.prepare(`
    SELECT s.*, r.status AS registration_status FROM registrations r
    JOIN sessions s ON s.id = r.session_id
    WHERE r.attendee_id = ? ORDER BY s.starts_at
  `).all(attendeeId);
}

export function getAttendeeNotifications(db: Database, attendeeId: string) {
  return db.prepare(`
    SELECT o.*, s.title AS session_title FROM outbox o
    JOIN sessions s ON s.id = o.session_id
    WHERE o.attendee_id = ? ORDER BY o.created_at DESC
  `).all(attendeeId);
}

export function listActivity(db: Database) {
  return db.prepare(`
    SELECT e.*, s.title AS session_title FROM audit_events e
    JOIN sessions s ON s.id = e.session_id
    ORDER BY e.created_at DESC LIMIT 20
  `).all();
}

export function changeRoom(db: Database, sessionId: string, room: string, actor: string, requestId?: string) {
  const session = db.prepare('SELECT id, room FROM sessions WHERE id = ?').get(sessionId) as { id: string; room: string } | undefined;
  if (!session) return null;
  const changed = session.room !== room;
  if (changed) {
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE sessions SET room = ? WHERE id = ?').run(room, sessionId);
      db.prepare('INSERT INTO audit_events (id, kind, session_id, request_id, actor, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), 'room_changed', sessionId, requestId ?? null, actor, JSON.stringify({ before: session.room, after: room }), now);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { before: session.room, after: room, changed };
}

export function registerAttendee(db: Database, sessionId: string, attendeeId: string) {
  const session = db.prepare('SELECT id, capacity FROM sessions WHERE id = ?').get(sessionId) as { id: string; capacity: number } | undefined;
  const attendee = db.prepare('SELECT id FROM attendees WHERE id = ?').get(attendeeId);
  if (!session || !attendee) return { error: 'not_found' as const };
  const count = db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE session_id = ? AND status = 'registered'").get(sessionId) as { count: number };
  if (count.count >= session.capacity) return { error: 'full' as const };
  const result = db.prepare('INSERT OR IGNORE INTO registrations (id, session_id, attendee_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), sessionId, attendeeId, 'registered', new Date().toISOString());
  return { created: result.changes > 0 };
}

export function enqueueJob(db: Database, kind: string, payload: any, runAt = new Date().toISOString()) {
  const id = randomUUID();
  db.prepare('INSERT INTO jobs (id, kind, payload_json, run_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, kind, JSON.stringify(payload), runAt, new Date().toISOString());
  return id;
}

export function claimJob(db: Database) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const job = db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT 1")
      .get(new Date().toISOString()) as { id: string; kind: string; payload_json: string } | undefined;
    if (job) db.prepare("UPDATE jobs SET status = 'processing' WHERE id = ?").run(job.id);
    db.exec('COMMIT');
    return job ?? null;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function completeJob(db: Database, jobId: string) {
  db.prepare("UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?").run(new Date().toISOString(), jobId);
}

export function failJob(db: Database, jobId: string) {
  db.prepare("UPDATE jobs SET status = 'failed', completed_at = ? WHERE id = ?").run(new Date().toISOString(), jobId);
}

export function insertOutbox(db: Database, jobId: string, sessionId: string, attendeeId: string, kind: string, subject: string, body: string) {
  db.prepare('INSERT OR IGNORE INTO outbox (id, attendee_id, session_id, job_id, kind, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), attendeeId, sessionId, jobId, kind, subject, body, new Date().toISOString());
}
