# Architecture map

Linked from the [root agent map](../../AGENTS.md). Product context lives in [Product](../product.md); commands live in [README](../../README.md).

## Components

Eventdesk has three running processes. The Next.js web app sends browser requests through `/backend` to a Fastify API. The API accesses PostgreSQL data and can queue work. A separate worker processes jobs and creates in-app notifications. It polls locally; Vercel Queues delivers jobs to the hosted worker. The API and worker must use the same database to serve one event.

The data package owns database operations; versioned migrations initialize the schema. Static architecture restrictions are defined by [ESLint](../../eslint.config.mjs), with verification wired in [the verifier](../../scripts/verify.sh).

## Source map

| Area | Read when | Entry points |
|---|---|---|
| Organizer | changing session management, controls, or activity display | [Dashboard](../../apps/web/src/app/organizer-dashboard.tsx) |
| Attendee | changing personal schedules or notifications | [Attendee view](../../apps/web/src/app/attendee/[id]/attendee-view.tsx), [page](../../apps/web/src/app/attendee/[id]/page.tsx) |
| HTTP | changing request/response behavior | [API](../../apps/api/src/index.ts) |
| Background work | changing how queued jobs run | [Worker](../../apps/worker/src/index.ts), [processor](../../apps/worker/src/process-job.ts), [hosted queue handler](../../apps/worker/api/consume.ts) |
| Persistence | changing stored state, queries, or schema | [Data](../../packages/data/src/index.ts), [paths](../../packages/data/src/paths.ts) |
| Diagnostics | investigating service activity | [Log writer](../../packages/data/src/log.ts) |
| Web/API connection | changing where browser requests go | [Next configuration](../../apps/web/next.config.ts) |
| Demo and checks | finding fixture data or verification | [Seed](../../scripts/seed.ts), [smoke check](../../scripts/smoke-reminder.mjs), [package scripts](../../package.json) |

Start with the relevant surface, then follow its API and data calls. Check other readers of the same state before changing its meaning.
