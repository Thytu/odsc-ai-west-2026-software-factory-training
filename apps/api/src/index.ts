import Fastify from 'fastify';
import {
  changeRoom,
  enqueueJob,
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

function getSession(db: Database, id: string) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return null;
  const registrations = db.prepare(`
    SELECT a.id, a.name, a.email, a.company, r.status
    FROM registrations r JOIN attendees a ON a.id = r.attendee_id
    WHERE r.session_id = ? ORDER BY a.name
  `).all(id);
  return { ...session, registrations };
}

const db = openDatabase();
const app = Fastify({ logger: false });

app.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id);
  recordEvent('api', 'request_started', { requestId: request.id, method: request.method, path: request.url });
});

app.addHook('onResponse', async (request, reply) => {
  recordEvent('api', 'request_completed', { requestId: request.id, method: request.method, path: request.url, status: reply.statusCode });
});

app.get('/health', async () => ({ ok: true, service: 'eventdesk-api' }));
app.get('/sessions', async () => listSessions(db));
app.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
  const session = getSession(db, request.params.id);
  if (!session) return reply.code(404).send({ error: 'Session not found' });
  return session;
});
app.get('/attendees', async () => listAttendees(db));
app.get<{ Params: { id: string } }>('/attendees/:id/schedule', async (request, reply) => {
  if (!listAttendees(db).some((attendee: any) => attendee.id === request.params.id)) {
    return reply.code(404).send({ error: 'Attendee not found' });
  }
  return getAttendeeSchedule(db, request.params.id);
});
app.get<{ Params: { id: string } }>('/attendees/:id/notifications', async (request, reply) => {
  if (!listAttendees(db).some((attendee: any) => attendee.id === request.params.id)) {
    return reply.code(404).send({ error: 'Attendee not found' });
  }
  return getAttendeeNotifications(db, request.params.id);
});
app.get('/activity', async () => listActivity(db));

app.post<{ Params: { id: string } }>('/sessions/:id/registrations', async (request, reply) => {
  const body: any = request.body;
  const attendeeId = typeof body?.attendeeId === 'string' ? body.attendeeId : '';
  if (!attendeeId) return reply.code(400).send({ error: 'Choose an attendee' });
  const result = registerAttendee(db, request.params.id, attendeeId);
  if ('error' in result) {
    return reply.code(result.error === 'full' ? 409 : 404).send({ error: result.error === 'full' ? 'Session is full' : 'Session or attendee not found' });
  }
  recordEvent('api', 'registration_recorded', { requestId: request.id, sessionId: request.params.id, attendeeId, created: result.created });
  return reply.code(result.created ? 201 : 200).send(result);
});

app.patch<{ Params: { id: string } }>('/sessions/:id/room', async (request, reply) => {
  const body: any = request.body;
  const room = typeof body?.room === 'string' ? body.room.trim() : '';
  if (!room || room.length > 80) return reply.code(400).send({ error: 'Room must be between 1 and 80 characters' });
  const result = changeRoom(db, request.params.id, room, 'organizer', request.id);
  if (!result) return reply.code(404).send({ error: 'Session not found' });
  recordEvent('api', 'room_updated', { requestId: request.id, sessionId: request.params.id, ...result });
  return result;
});

app.post<{ Params: { id: string } }>('/sessions/:id/reminders', async (request, reply) => {
  const session = getSession(db, request.params.id);
  if (!session) return reply.code(404).send({ error: 'Session not found' });
  const jobId = enqueueJob(db, 'session_reminder', { sessionId: request.params.id, requestId: request.id });
  recordEvent('api', 'reminder_queued', { requestId: request.id, jobId, sessionId: request.params.id });
  return reply.code(202).send({ jobId });
});

app.setErrorHandler((error, request, reply) => {
  recordEvent('api', 'request_failed', { requestId: request.id, error: error instanceof Error ? error.message : String(error) });
  reply.code(500).send({ error: 'Unexpected server error' });
});

const port = Number(process.env.API_PORT ?? 4000);
try {
  await app.listen({ port, host: '127.0.0.1' });
  recordEvent('api', 'server_started', { port });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
