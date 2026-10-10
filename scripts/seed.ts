import { openDatabase, enqueueJob } from '@eventdesk/data';

const pool = openDatabase();
const db = await pool.connect().catch(async error => { await pool.end(); throw error; });
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(1698516001)');
  const date = (days: number, hour: number) => {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + days);
    value.setUTCHours(hour, 0, 0, 0);
    return value.toISOString();
  };

  const sessions = [
    ['session-101', 'Designing with Coding Agents', 'Engineering', 'A practical look at how teams make coding agents productive across a real codebase.', 'Cypress A', date(7, 17), date(7, 18), 24],
    ['session-102', 'Data Systems in Practice', 'Data', 'Patterns for operating data products that people rely on every day.', 'Harbor B', date(7, 19), date(7, 20), 18],
    ['session-103', 'Shipping Reliable AI Products', 'AI', 'From prototypes to observable, testable user experiences.', 'Summit C', date(8, 16), date(8, 17), 30],
  ] as const;

  for (const session of sessions) {
    await db.query('INSERT INTO sessions (id, title, track, summary, room, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING', [...session]);
  }

  const attendees = [
    ['attendee-101', 'Maya Chen', 'maya@example.test', 'Northstar Labs'],
    ['attendee-102', 'Jonah Patel', 'jonah@example.test', 'Meridian'],
    ['attendee-103', 'Amara Okafor', 'amara@example.test', 'Fieldnote'],
    ['attendee-104', 'Leo Martin', 'leo@example.test', 'Atlas Works'],
  ] as const;
  for (const attendee of attendees) {
    await db.query('INSERT INTO attendees (id, name, email, company) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [...attendee]);
  }

  const registrations = [
    ['session-101', 'attendee-101'], ['session-101', 'attendee-102'], ['session-101', 'attendee-103'],
    ['session-102', 'attendee-102'], ['session-102', 'attendee-104'],
    ['session-103', 'attendee-101'], ['session-103', 'attendee-104'],
  ];
  for (const [sessionId, attendeeId] of registrations) {
    await db.query('INSERT INTO registrations (id, session_id, attendee_id, status, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [`${sessionId}-${attendeeId}`, sessionId, attendeeId, 'registered', new Date().toISOString()]);
  }

  const existingJob = (await db.query("SELECT id FROM jobs WHERE kind = 'session_reminder' LIMIT 1")).rows[0];
  if (!existingJob) await enqueueJob(db, 'session_reminder', { sessionId: 'session-101' });
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  db.release();
  await pool.end();
}
