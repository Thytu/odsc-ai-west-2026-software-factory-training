import { claimJob, completeJob, failJob, insertOutbox, openDatabase, transaction } from '@eventdesk/data';
import { recordEvent } from '@eventdesk/data/log';

export async function processNextJob(db: ReturnType<typeof openDatabase>, jobId?: string) {
  let claimed: string | undefined;
  try {
    return await transaction(db, async client => {
      const job = await claimJob(client, jobId);
      if (!job) return null;
      claimed = job.id;
      recordEvent('worker', 'job_started', { jobId: job.id, kind: job.kind });
      const payload: any = JSON.parse(job.payload_json);
      if (job.kind !== 'session_reminder') throw new Error(`Unknown job kind: ${job.kind}`);
      const session = (await client.query('SELECT id, title, room, starts_at FROM sessions WHERE id = $1', [payload.sessionId])).rows[0] as any;
      if (!session) throw new Error(`Session not found: ${payload.sessionId}`);
      const recipients = (await client.query("SELECT a.id FROM registrations r JOIN attendees a ON a.id = r.attendee_id WHERE r.session_id = $1 AND r.status = 'registered'", [session.id])).rows as Array<{ id: string }>;
      for (const recipient of recipients) {
        await insertOutbox(client, job.id, session.id, recipient.id, 'session_reminder',
          `Reminder: ${session.title}`,
          `${session.title} starts ${new Date(session.starts_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })} PT in ${session.room}.`);
      }
      await completeJob(client, job.id);
      return { jobId: job.id, requestId: payload.requestId ?? null, sessionId: session.id, recipients: recipients.map(recipient => recipient.id) };
    }).then(result => {
      if (result) {
        for (const attendeeId of result.recipients) recordEvent('worker', 'notification_created', { jobId: result.jobId, requestId: result.requestId, sessionId: result.sessionId, attendeeId });
        recordEvent('worker', 'job_completed', { jobId: result.jobId, requestId: result.requestId, sessionId: result.sessionId, recipients: result.recipients.length });
      }
      return result;
    });
  } catch (error) {
    if (claimed) await failJob(db, claimed);
    recordEvent('worker', 'job_failed', { jobId: claimed ?? jobId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
