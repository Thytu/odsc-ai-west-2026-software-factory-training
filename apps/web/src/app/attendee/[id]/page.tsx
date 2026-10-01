import AttendeeView from './attendee-view';

export default async function AttendeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AttendeeView attendeeId={id} />;
}
