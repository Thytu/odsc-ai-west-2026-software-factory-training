'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Session = { id: string; title: string; track: string; room: string; starts_at: string; summary: string };
type Notification = { id: string; subject: string; body: string; created_at: string; session_title: string };
type Attendee = { id: string; name: string; company: string };

function date(value: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function AttendeeView({ attendeeId }: { attendeeId: string }) {
  const [person, setPerson] = useState<Attendee | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/backend/attendees').then((res) => res.json()),
      fetch(`/backend/attendees/${attendeeId}/schedule`).then((res) => { if (!res.ok) throw new Error('Attendee not found'); return res.json(); }),
      fetch(`/backend/attendees/${attendeeId}/notifications`).then((res) => res.json()),
    ]).then(([people, nextSessions, nextNotifications]) => {
      setPerson((people as Attendee[]).find((item) => item.id === attendeeId) ?? null);
      setSessions(nextSessions);
      setNotifications(nextNotifications);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoading(false));
  }, [attendeeId]);

  return <main className="mx-auto max-w-4xl px-6 pb-20 pt-10">
    <Link href="/" className="text-sm font-semibold text-[#527da9] hover:underline">← Organizer dashboard</Link>
    <div className="mt-12 border-b border-[#e0e7ef] pb-8"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6285ab]">Harbor Summit · Attendee view</p><h1 className="mt-3 text-4xl font-bold tracking-tight">{person ? `${person.name}'s schedule` : 'Attendee schedule'}</h1><p className="mt-2 text-sm text-[#7d8b9c]">{person?.company ?? 'Sessions and updates in one place.'}</p></div>
    {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {loading ? <p className="py-12 text-sm text-[#728095]">Loading schedule…</p> : <div className="mt-8 grid gap-8 md:grid-cols-[1.2fr_1fr]">
      <section><h2 className="text-xl font-bold">Your sessions</h2><div className="mt-4 space-y-4">{sessions.length ? sessions.map((session) => <article key={session.id} className="rounded-2xl border border-[#e4eaf1] bg-white p-5"><p className="text-xs font-bold uppercase tracking-[0.13em] text-[#6b8bb0]">{session.track} · {date(session.starts_at)}</p><h3 className="mt-3 text-lg font-bold">{session.title}</h3><p className="mt-2 text-sm leading-6 text-[#718096]">{session.summary}</p><span className="legacy-room-tag mt-5">{session.room}</span></article>) : <p className="rounded-xl bg-white p-5 text-sm text-[#7d8b9c]">No sessions on this schedule.</p>}</div></section>
      <section><h2 className="text-xl font-bold">Notifications</h2><div className="mt-4 space-y-3">{notifications.length ? notifications.map((notice) => <article key={notice.id} className="rounded-2xl border border-[#e4eaf1] bg-white p-5"><h3 className="text-sm font-bold">{notice.subject}</h3><p className="mt-2 text-sm leading-6 text-[#718096]">{notice.body}</p><p className="mt-3 text-xs text-[#98a3b1]">{date(notice.created_at)}</p></article>) : <p className="rounded-xl bg-white p-5 text-sm text-[#7d8b9c]">No notifications yet.</p>}</div></section>
    </div>}
  </main>;
}
