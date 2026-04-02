import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return databaseUrl;
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
    });
  }

  return pool;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  host_player_id UUID NOT NULL,
  status TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat_index INTEGER NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  role TEXT NULL,
  status TEXT NOT NULL,
  reconnect_token_hash TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS players_room_seat_index_key
  ON players (room_id, seat_index)
  WHERE seat_index IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS players_reconnect_token_hash_key
  ON players (reconnect_token_hash);

CREATE INDEX IF NOT EXISTS players_room_id_idx
  ON players (room_id);

CREATE TABLE IF NOT EXISTS games (
  room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  state JSONB NULL,
  winner TEXT NULL,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  disconnect_deadline TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_events (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS room_events_room_created_idx
  ON room_events (room_id, created_at DESC);
`;

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(schemaSql).then(() => undefined);
  }

  await schemaReady;
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
) {
  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
