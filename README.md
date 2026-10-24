# Eventdesk

An event-day coordination app for organizers and attendees. Start with [Product](docs/product.md) and the [architecture map](docs/architecture/AGENTS.md).

## Setup and run

Use Node 24+ and pnpm 12.4.2. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Approve the local certificate/service prompt from `pnpm run setup`. Open the named HTTPS address printed by `pnpm dev`. Run `pnpm context` to retrieve it again. Each Git worktree gets its own address; the browser uses that environment's `/backend` proxy.

Use `pnpm stop` from another terminal in the same checkout, or Ctrl+C in the running terminal, to stop its services and database.

The development command starts a checkout-specific PostgreSQL database, runs migrations, seeds demo records, and starts the web app, API, and worker. Local database files live in `.data/postgres`; service logs are `.data/events.jsonl`. The API and worker use the same checkout's database.

`pnpm seed` inserts missing demo records and can queue the initial demo reminder. With `pnpm dev` stopped, `pnpm reset` resets the checkout's database and seeds it again. These are demo-data operations; use disposable data when experimenting.

## Verification

```sh
pnpm check:data-boundary
pnpm check
pnpm smoke:reminder
pnpm build
```

These run the architecture lint, TypeScript checks, a basic reminder smoke test, and the web build. The smoke test uses its own temporary data. Read [the smoke assertions](scripts/smoke-reminder.mjs) for exact coverage. For the complete sequence, run:

```sh
bash scripts/verify.sh --full
```

Passing static checks and a build is not evidence that a new product behavior works. Verify the affected flow separately.
