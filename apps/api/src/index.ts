import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { send } from '@vercel/queue';
import {
  changeRoom,
  enqueueJob,
  failJob,
  getAttendeeNotifications,
  getAttendeeSchedule,
  listActivity,
  listAttendees,
  listSessions,
  openDatabase,
  registerAttendee,
} from '@eventdesk/data';
import { recordEvent } from '@eventdesk/data/log';

type Database = ReturnType<typeof openDatabase>;

async function getSession(db: Database, id: string) {
  const session = (await db.query('SELECT * FROM sessions WHERE id = $1', [id])).rows[0];
  if (!session) return null;
  const registrations = (await db.query(`
    SELECT a.id, a.name, a.email, a.company, r.status
    FROM registrations r JOIN attendees a ON a.id = r.attendee_id
    WHERE r.session_id = $1 ORDER BY a.name
  `, [id])).rows;
  return { ...session, registrations };
}

const db = openDatabase();
const app = Fastify({ logger: false, genReqId: () => randomUUID() });

app.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id);
  recordEvent('api', 'request_started', { requestId: request.id, method: request.method, path: request.url });
});

app.addHook('onResponse', async (request, reply) => {
  recordEvent('api', 'request_completed', { requestId: request.id, method: request.method, path: request.url, status: reply.statusCode });
});

app.get('/backend/health', async () => {
  await listSessions(db);
  return { ok: true, service: 'eventdesk-api', version: process.env.DEPLOY_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || 'local', environment: process.env.PORTLESS_URL ?? process.env.VERCEL_URL ?? 'local' };
});
app.get('/backend/sessions', async () => listSessions(db));
app.get<{ Params: { id: string } }>('/backend/sessions/:id', async (request, reply) => {
  const session = await getSession(db, request.params.id);
  if (!session) return reply.code(404).send({ error: 'Session not found' });
  return session;
});
app.get('/backend/attendees', async () => listAttendees(db));
app.get<{ Params: { id: string } }>('/backend/attendees/:id/schedule', async (request, reply) => {
  if (!(await listAttendees(db)).some((attendee: any) => attendee.id === request.params.id)) {
    return reply.code(404).send({ error: 'Attendee not found' });
  }
  return getAttendeeSchedule(db, request.params.id);
});
app.get<{ Params: { id: string } }>('/backend/attendees/:id/notifications', async (request, reply) => {
  if (!(await listAttendees(db)).some((attendee: any) => attendee.id === request.params.id)) {
    return reply.code(404).send({ error: 'Attendee not found' });
  }
  return getAttendeeNotifications(db, request.params.id);
});
app.get('/backend/activity', async () => listActivity(db));

app.post<{ Params: { id: string } }>('/backend/sessions/:id/registrations', async (request, reply) => {
  const body: any = request.body;
  const attendeeId = typeof body?.attendeeId === 'string' ? body.attendeeId : '';
  if (!attendeeId) return reply.code(400).send({ error: 'Choose an attendee' });
  const result = await registerAttendee(db, request.params.id, attendeeId);
  if ('error' in result) {
    return reply.code(result.error === 'full' ? 409 : 404).send({ error: result.error === 'full' ? 'Session is full' : 'Session or attendee not found' });
  }
  recordEvent('api', 'registration_recorded', { requestId: request.id, sessionId: request.params.id, attendeeId, created: result.created });
  return reply.code(result.created ? 201 : 200).send(result);
});

app.patch<{ Params: { id: string } }>('/backend/sessions/:id/room', async (request, reply) => {
  const body: any = request.body;
  const room = typeof body?.room === 'string' ? body.room.trim() : '';
  if (!room || room.length > 80) return reply.code(400).send({ error: 'Room must be between 1 and 80 characters' });
  const result = await changeRoom(db, request.params.id, room, 'organizer', request.id);
  if (!result) return reply.code(404).send({ error: 'Session not found' });
  recordEvent('api', 'room_updated', { requestId: request.id, sessionId: request.params.id, ...result });
  return result;
});

app.post<{ Params: { id: string } }>('/backend/sessions/:id/reminders', async (request, reply) => {
  const session = await getSession(db, request.params.id);
  if (!session) return reply.code(404).send({ error: 'Session not found' });
  const jobId = await enqueueJob(db, 'session_reminder', { sessionId: request.params.id, requestId: request.id });
  if (process.env.VERCEL) {
    try {
      await send('eventdesk-reminders', { jobId }, { idempotencyKey: jobId, region: 'iad1' });
    } catch (error) {
      await failJob(db, jobId);
      recordEvent('api', 'reminder_publish_failed', { requestId: request.id, jobId, error: error instanceof Error ? error.message : String(error) });
      return reply.code(503).send({ error: 'The reminder service is unavailable. Please try again.' });
    }
  }
  recordEvent('api', 'reminder_queued', { requestId: request.id, jobId, sessionId: request.params.id });
  return reply.code(202).send({ jobId });
});

app.setErrorHandler((error, request, reply) => {
  recordEvent('api', 'request_failed', { requestId: request.id, error: error instanceof Error ? error.message : String(error) });
  reply.code(500).send({ error: 'Unexpected server error' });
});

const port = Number(process.env.PORT ?? 0);
void app.listen({ port, host: '127.0.0.1' }).then(() => {
  recordEvent('api', 'server_started', { port });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}

export default app;
