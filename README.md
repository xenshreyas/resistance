# Resistance

Realtime Resistance rooms built with Next.js 16, PostgreSQL, and Server-Sent Events.

## Features

- Private room code and share-link flow
- 4-6 seated players plus spectators
- Classic Resistance role distribution
- Hidden team voting and anonymous mission cards
- Rejoin-safe seats via HttpOnly room session cookies
- Soft pause on disconnect with automatic lobby reset after 5 minutes
- Single deployable Next.js app with a Railway-ready Dockerfile

## Stack

- Next.js 16 App Router
- React 19
- PostgreSQL via `pg`
- SSE for live room state fan-out
- Tailwind CSS 4

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create a PostgreSQL database and copy `.env.example` to `.env.local`.

3. Set `DATABASE_URL`:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/resistance
```

4. Start the app:

```bash
npm run dev
```

The schema is created automatically on first database access.

## Local Postgres with Docker Compose

Start Postgres:

```bash
docker compose up -d
```

Use this local connection string in `.env.local`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/resistance
```

Stop the database:

```bash
docker compose down
```

Stop it and remove the database volume:

```bash
docker compose down -v
```

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Runtime model

- All room mutations go through route handlers under `app/api/rooms/...`.
- Room state is persisted in PostgreSQL.
- Clients subscribe to `/api/rooms/[code]/events` with SSE.
- Player reconnect identity is stored in a room-scoped HttpOnly cookie.
- Viewer-specific room state is projected on the server so hidden information is never sent to the wrong client.

## Railway deployment

1. Create a new Railway project.
2. Add a PostgreSQL service.
3. Set `DATABASE_URL` on the app service from the Postgres service connection string.
4. Deploy this repo as a Dockerfile-based service or a standard Node service.
5. Expose port `3000` if Railway does not inject `PORT` automatically.

The app uses `output: "standalone"` and includes a Dockerfile compatible with Railway's container runtime.
