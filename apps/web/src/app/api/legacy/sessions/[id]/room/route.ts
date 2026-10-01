import { NextResponse } from 'next/server';
import { changeRoom, openDatabase } from '@eventdesk/data';
import { recordEvent } from '@eventdesk/data/log';

export const runtime = 'nodejs';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: any = await request.json().catch(() => ({}));
  const room = typeof body.room === 'string' ? body.room.trim() : '';
  if (!room) return NextResponse.json({ error: 'Room is required' }, { status: 400 });
  const db = openDatabase();
  try {
    const result = changeRoom(db, id, room, 'legacy-web-route');
    if (!result) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    recordEvent('web', 'legacy_room_updated', { sessionId: id, ...result });
    return NextResponse.json(result);
  } finally {
    db.close();
  }
}
