'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import styles from './session-card.module.css';

type Session = {
  id: string;
  title: string;
  track: string;
  summary: string;
  room: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  registration_count: number;
};
type Attendee = { id: string; name: string; email: string; company: string };
type Registration = Attendee & { status: string };
type Detail = Session & { registrations: Registration[] };
type Activity = { id: string; kind: string; session_title: string; actor: string; details_json: string; created_at: string };

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/backend${path}`, { cache: 'no-store', ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The request failed');
  return data as T;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export default function OrganizerDashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [selectedId, setSelectedId] = useState('session-101');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [room, setRoom] = useState('');
  const [attendeeId, setAttendeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [nextSessions, nextAttendees, nextActivity] = await Promise.all([
      readJson<Session[]>('/sessions'), readJson<Attendee[]>('/attendees'), readJson<Activity[]>('/activity'),
    ]);
    setSessions(nextSessions);
    setAttendees(nextAttendees);
    setActivity(nextActivity);
    if (!selectedId && nextSessions[0]) setSelectedId(nextSessions[0].id);
  }, [selectedId]);

  useEffect(() => {
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    readJson<Detail>(`/sessions/${selectedId}`)
      .then((next) => { setDetail(next); setRoom(next.room); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [selectedId]);

  async function runAction(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await action();
      await refresh();
      setDetail(await readJson<Detail>(`/sessions/${selectedId}`));
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  const active = sessions.find((session) => session.id === selectedId);
  const totalRegistrations = sessions.reduce((sum, session) => sum + session.registration_count, 0);

  return <div className="min-h-screen">
    <header className="border-b border-[#e6ebf1] bg-white">
      <div className="mx-auto flex max-w-[1320px] items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#172034] text-lg font-bold text-white">E</div>
          <div><div className="text-[17px] font-bold tracking-tight">Eventdesk</div><div className="text-xs text-[#7a8799]">Harbor Summit workspace</div></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full bg-[#edf7f2] px-3 py-1 text-xs font-semibold text-[#237752] sm:inline">● Live event</span>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dbe9f7] text-xs font-bold text-[#315479]">OR</div>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-[1320px] px-6 pb-16 pt-10">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#577eac]">Organizer dashboard</p><h1 className="text-3xl font-bold tracking-tight md:text-4xl">Sessions & attendees</h1><p className="mt-2 text-sm text-[#728095]">Manage the schedule and keep everyone informed.</p></div>
        <span className="rounded-lg border border-[#e4eaf1] bg-white px-4 py-2 text-sm text-[#66758b]">Pacific Time · Event week</span>
      </div>

      {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}

      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        <Stat label="Sessions" value={String(sessions.length).padStart(2, '0')} accent="text-[#335e93]" />
        <Stat label="Registrations" value={String(totalRegistrations).padStart(2, '0')} accent="text-[#568172]" />
        <Stat label="Rooms in use" value={String(new Set(sessions.map((session) => session.room)).size).padStart(2, '0')} accent="text-[#a17745]" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <section className="rounded-2xl border border-[#e6ebf1] bg-white p-6 shadow-[0_10px_35px_rgba(28,49,79,0.04)]">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">Upcoming sessions</h2><span className="text-xs text-[#8b98aa]">{sessions.length} scheduled</span></div>
          {loading ? <p className="py-12 text-center text-sm text-[#728095]">Loading sessions…</p> : sessions.length === 0 ? <p className="py-12 text-center text-sm text-[#728095]">No sessions scheduled yet.</p> :
            <div className="space-y-3">{sessions.map((session) => <button key={session.id} type="button" onClick={() => { setSelectedId(session.id); setNotice(''); setError(''); }} className={`w-full rounded-xl border p-4 text-left transition hover:border-[#b8cbe0] hover:bg-[#f9fbfd] ${selectedId === session.id ? 'border-[#aac3de] bg-[#f7faff]' : 'border-[#e9edf2]'}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-[#6285ab]">{session.track}</span><span className="text-xs text-[#7d8998]">{formatDate(session.starts_at)}</span></div>
              <div className="mb-3 text-[16px] font-bold">{session.title}</div>
              <div className="flex items-center justify-between"><span className={styles.roomLabel}>{session.room}</span><span className="text-xs text-[#718095]">{session.registration_count} / {session.capacity} registered</span></div>
            </button>)}</div>}
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-[#e6ebf1] bg-white p-6 shadow-[0_10px_35px_rgba(28,49,79,0.04)]">
            <h2 className="text-lg font-bold">Session details</h2>
            {!active || !detail || detail.id !== selectedId ? <p className="mt-5 text-sm text-[#728095]">Select a session to manage it.</p> : <>
              <p className="mt-1 text-sm text-[#728095]">{active.title}</p>
              <div className="mt-6 border-t border-[#edf0f3] pt-5"><label htmlFor="room" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#68778b]">Assigned room</label>
                <div className="flex gap-2"><input id="room" value={room} onChange={(event) => setRoom(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[#dbe3eb] px-3 py-2 text-sm outline-none focus:border-[#5c87b7]" /><button disabled={busy || room.trim() === active.room} onClick={() => runAction(() => readJson(`/sessions/${selectedId}/room`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room }) }), 'Room updated.')} className="rounded-lg bg-[#263c5c] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">Save</button></div>
              </div>
              <div className="mt-6 border-t border-[#edf0f3] pt-5"><label htmlFor="attendee" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#68778b]">Add registration</label><div className="flex gap-2"><select id="attendee" value={attendeeId} onChange={(event) => setAttendeeId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[#dbe3eb] bg-white px-3 py-2 text-sm"><option value="">Choose attendee</option>{attendees.map((attendee) => <option key={attendee.id} value={attendee.id}>{attendee.name}</option>)}</select><button disabled={busy || !attendeeId} onClick={() => runAction(() => readJson(`/sessions/${selectedId}/registrations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attendeeId }) }), 'Registration saved.')} className="rounded-lg border border-[#c8d4e0] px-3 py-2 text-sm font-semibold text-[#334761] disabled:opacity-45">Add</button></div></div>
              <div className="mt-6 border-t border-[#edf0f3] pt-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">Registered attendees</h3><span className="text-xs text-[#8492a3]">{detail.registrations.length}</span></div><div className="space-y-2">{detail.registrations.length ? detail.registrations.map((person) => <Link key={person.id} href={`/attendee/${person.id}`} className="flex items-center justify-between rounded-lg bg-[#f8fafc] px-3 py-2 text-sm hover:bg-[#eef4fa]"><span>{person.name}</span><span className="text-xs text-[#8291a4]">View schedule ↗</span></Link>) : <p className="text-sm text-[#8190a1]">No registrations yet.</p>}</div></div>
              <button disabled={busy} onClick={() => runAction(() => readJson(`/sessions/${selectedId}/reminders`, { method: 'POST' }), 'Reminder queued for registered attendees.')} className="mt-6 w-full rounded-lg bg-[#eaf1f8] px-4 py-3 text-sm font-bold text-[#315a84] hover:bg-[#dfeaf5] disabled:opacity-45">Send session reminder</button>
            </>}
          </section>
          <section className="rounded-2xl border border-[#e6ebf1] bg-white p-6"><h2 className="text-base font-bold">Recent activity</h2><div className="mt-4 space-y-4">{activity.length ? activity.slice(0, 4).map((item) => <div key={item.id} className="border-l-2 border-[#bfd3e7] pl-3"><p className="text-sm font-semibold">Room updated · {item.session_title}</p><p className="mt-1 text-xs text-[#8290a0]">{formatDate(item.created_at)} by {item.actor}</p></div>) : <p className="text-sm text-[#8290a0]">Changes to sessions will appear here.</p>}</div></section>
        </aside>
      </div>
    </main>
  </div>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className="rounded-2xl border border-[#e6ebf1] bg-white p-5 shadow-[0_10px_35px_rgba(28,49,79,0.03)]"><div className="text-xs font-semibold uppercase tracking-[0.15em] text-[#8593a5]">{label}</div><div className={`mt-3 text-3xl font-bold tracking-tight ${accent}`}>{value}</div></div>;
}
