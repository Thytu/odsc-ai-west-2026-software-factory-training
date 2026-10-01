import { claimJob, completeJob, failJob, insertOutbox, openDatabase } from '@eventdesk/data';
import { recordEvent } from '@eventdesk/data/log';

const db = openDatabase();
let busy = false;

function processNextJob() {
  if (busy) return;
  busy = true;
  try {
    const job = claimJob(db);
    if (!job) return;
    recordEvent('worker', 'job_started', { jobId: job.id, kind: job.kind });
    try {
      const payload: any = JSON.parse(job.payload_json);
      if (job.kind !== 'session_reminder') throw new Error(`Unknown job kind: ${job.kind}`);
      const session = db.prepare('SELECT id, title, room, starts_at FROM sessions WHERE id = ?').get(payload.sessionId) as any;
      if (!session) throw new Error(`Session not found: ${payload.sessionId}`);
      const recipients = db.prepare("SELECT a.id FROM registrations r JOIN attendees a ON a.id = r.attendee_id WHERE r.session_id = ? AND r.status = 'registered'").all(session.id) as Array<{ id: string }>;
      for (const recipient of recipients) {
        insertOutbox(db, job.id, session.id, recipient.id, 'session_reminder',
          `Reminder: ${session.title}`,
          `${session.title} starts ${new Date(session.starts_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })} PT in ${session.room}.`);
        recordEvent('worker', 'notification_created', { jobId: job.id, requestId: payload.requestId ?? null, sessionId: session.id, attendeeId: recipient.id });
      }
      completeJob(db, job.id);
      recordEvent('worker', 'job_completed', { jobId: job.id, requestId: payload.requestId ?? null, sessionId: session.id, recipients: recipients.length });
    } catch (error) {
      failJob(db, job.id);
      recordEvent('worker', 'job_failed', { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    }
  } catch (error) {
    recordEvent('worker', 'poll_failed', { error: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
  }
}

recordEvent('worker', 'worker_started');
processNextJob();
const timer = setInterval(processNextJob, 700);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    db.close();
    process.exit(0);
  });
}
