# Eventdesk

## Purpose and people

Eventdesk is an event-day coordination app. Organizers manage the programme and registrations; attendees need their personal schedule and session notices in one place. The demo event is Harbor Summit.

An organizer uses the root dashboard. They can inspect sessions and registrations, register an existing attendee, change a session's room, and request a reminder. An attendee opens their individual page from the dashboard's attendee links; it shows their schedule and notifications.

## Product vocabulary

- A **session** is a scheduled event with a title, track, summary, room, start/end times, and capacity.
- An **attendee** is a person in the event directory. Being in that directory does not mean they are registered for every session.
- A **registration** connects an attendee to a session and carries a status.
- A **reminder** is requested by an organizer and produced by background work.
- A **notification** is a stored message shown in an attendee's Eventdesk page. The storage table is named `outbox`; there is no external email or push delivery integration.
- **Activity** is the organizer's recent change history. It is distinct from service logs used by developers.

## Current surfaces

The organizer dashboard has a session list, a selected-session panel with registrations and a reminder notification count, registration and room controls, a reminder button, recent activity, and links to attendee pages.

The attendee page has a schedule and notifications. Times are presented in Pacific Time. The data module is the source for stored event state; the browser retrieves it through the API.

This is a local single-event demo. The existing UI does not create events, sessions, or attendee accounts, and the API has no authentication or role enforcement. Role names describe the UI's audiences, not implemented access controls. Do not assume those capabilities exist.

See the [architecture map](architecture/AGENTS.md) for the components behind these surfaces. Verify detailed behavior in source when making a change.
