import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { ensureSchema, getPool, withTransaction } from "@/lib/server/db";
import { notifyRoom } from "@/lib/server/realtime";
import {
  advanceAfterReveal,
  applyProposal,
  assignRoles,
  createInitialGameState,
  getMissionTeamSize,
  submitApprovalVote,
  submitMissionCard,
} from "@/lib/server/game";
import type {
  EventLogEntry,
  GameRecord,
  GameState,
  PlayerRecord,
  PlayerRole,
  PlayerStatus,
  RoomConfig,
  RoomRecord,
  ViewerRoomState,
  VoteChoice,
  MissionCard,
} from "@/lib/types";

const DEFAULT_CONFIG: RoomConfig = {
  missionCount: 5,
  missionSizes: [2, 2, 3, 2, 3],
};

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STALE_PRESENCE_MS = 45 * 1000;

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 32);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function roomCookieName(roomCode: string) {
  return `resistance_session_${roomCode}`;
}

function parseRoomCode(value: string) {
  return value.trim().toUpperCase();
}

function generateReconnectToken() {
  return randomBytes(24).toString("hex");
}

function generateRoomCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function coerceRoom(row: QueryResultRow): RoomRecord {
  return row as RoomRecord;
}

function coercePlayer(row: QueryResultRow): PlayerRecord {
  return row as PlayerRecord;
}

function coerceGame(row: QueryResultRow): GameRecord | null {
  return (row as GameRecord | undefined) ?? null;
}

async function getRoomByCode(client: PoolClient, roomCode: string) {
  const result = await client.query("SELECT * FROM rooms WHERE code = $1", [roomCode]);
  return result.rows[0] ? coerceRoom(result.rows[0]) : null;
}

async function getPlayersByRoomId(client: PoolClient, roomId: string) {
  const result = await client.query(
    "SELECT * FROM players WHERE room_id = $1 ORDER BY seat_index NULLS LAST, created_at ASC",
    [roomId],
  );
  return result.rows.map(coercePlayer);
}

async function getGameByRoomId(client: PoolClient, roomId: string) {
  const result = await client.query("SELECT * FROM games WHERE room_id = $1", [roomId]);
  return coerceGame(result.rows[0]);
}

async function getEventsByRoomId(client: PoolClient, roomId: string) {
  const result = await client.query(
    "SELECT * FROM room_events WHERE room_id = $1 ORDER BY created_at DESC LIMIT 30",
    [roomId],
  );
  return result.rows.reverse();
}

async function appendEvent(
  client: PoolClient,
  roomId: string,
  kind: string,
  message: string,
) {
  await client.query(
    "INSERT INTO room_events (id, room_id, kind, message) VALUES ($1, $2, $3, $4)",
    [randomUUID(), roomId, kind, message],
  );
}

function validateConfig(config: RoomConfig) {
  if (
    !Number.isInteger(config.missionCount) ||
    config.missionCount < 1 ||
    config.missionCount !== config.missionSizes.length
  ) {
    throw new Error("Mission count must match the number of mission sizes.");
  }

  for (const size of config.missionSizes) {
    if (!Number.isInteger(size) || size < 1) {
      throw new Error("Mission sizes must be positive integers.");
    }
  }
}

function ensurePlayerCount(players: PlayerRecord[]) {
  const seatedPlayers = players.filter((player) => player.seat_index !== null);
  if (seatedPlayers.length < 4 || seatedPlayers.length > 6) {
    throw new Error("A game requires 4 to 6 seated players.");
  }
  return seatedPlayers;
}

function uniqueDisplayName(rawName: string, players: PlayerRecord[]) {
  const base = cleanName(rawName);
  if (!base) {
    throw new Error("Display name is required.");
  }

  const normalized = normalizeName(base);
  const names = new Set(players.map((player) => player.display_name));

  if (!names.has(base)) {
    return { displayName: base, normalizedName: normalized };
  }

  let suffix = 1;
  while (names.has(`${base} (${suffix})`)) {
    suffix += 1;
  }

  return {
    displayName: `${base} (${suffix})`,
    normalizedName: normalizeName(`${base} (${suffix})`),
  };
}

async function findPlayerByTokenHash(
  client: PoolClient,
  roomId: string,
  reconnectTokenHash: string,
) {
  const result = await client.query(
    "SELECT * FROM players WHERE room_id = $1 AND reconnect_token_hash = $2",
    [roomId, reconnectTokenHash],
  );
  return result.rows[0] ? coercePlayer(result.rows[0]) : null;
}

function determineKnownSpies(viewer: PlayerRecord | null, players: PlayerRecord[]) {
  if (!viewer || viewer.role !== "spy") {
    return [];
  }

  return players.filter((player) => player.role === "spy").map((player) => player.id);
}

async function maybeMarkStaleDisconnected(
  client: PoolClient,
  room: RoomRecord,
  players: PlayerRecord[],
  game: GameRecord | null,
) {
  if (!game || room.status !== "in_game") {
    return false;
  }

  const now = Date.now();
  const stalePlayerIds = players
    .filter(
      (player) =>
        player.seat_index !== null &&
        player.status === "active" &&
        now - new Date(player.last_seen_at).getTime() > STALE_PRESENCE_MS,
    )
    .map((player) => player.id);

  if (stalePlayerIds.length === 0) {
    return false;
  }

  await client.query(
    "UPDATE players SET status = 'disconnected', updated_at = NOW() WHERE id = ANY($1::uuid[])",
    [stalePlayerIds],
  );
  await client.query(
    "UPDATE games SET paused = TRUE, disconnect_deadline = COALESCE(disconnect_deadline, NOW() + INTERVAL '5 minutes'), updated_at = NOW() WHERE room_id = $1",
    [room.id],
  );
  await appendEvent(client, room.id, "disconnect", "A seated player disconnected. The game is paused.");
  return true;
}

async function resetRoomToLobby(
  client: PoolClient,
  room: RoomRecord,
  reason: string,
) {
  await client.query(
    "UPDATE rooms SET status = 'lobby', updated_at = NOW() WHERE id = $1",
    [room.id],
  );
  await client.query(
    "UPDATE players SET role = NULL, updated_at = NOW() WHERE room_id = $1",
    [room.id],
  );
  await client.query(
    "UPDATE games SET state = NULL, winner = NULL, paused = FALSE, disconnect_deadline = NULL, updated_at = NOW() WHERE room_id = $1",
    [room.id],
  );
  await appendEvent(client, room.id, "reset", reason);
}

async function reseatPlayers(client: PoolClient, roomId: string) {
  const players = await getPlayersByRoomId(client, roomId);
  const seatedPlayers = players
    .filter((player) => player.seat_index !== null)
    .sort((left, right) => (left.seat_index ?? 999) - (right.seat_index ?? 999));

  for (const [seatIndex, player] of seatedPlayers.entries()) {
    if (player.seat_index !== seatIndex) {
      await client.query(
        "UPDATE players SET seat_index = $2, updated_at = NOW() WHERE id = $1",
        [player.id, seatIndex],
      );
    }
  }
}

async function maybeAutoResetPausedGame(
  client: PoolClient,
  room: RoomRecord,
  game: GameRecord | null,
) {
  if (
    !game ||
    !game.paused ||
    !game.disconnect_deadline ||
    new Date(game.disconnect_deadline).getTime() > Date.now()
  ) {
    return false;
  }

  await resetRoomToLobby(
    client,
    room,
    "The room returned to the lobby after a disconnected player did not return in time.",
  );
  return true;
}

async function hydrateRoomState(client: PoolClient, roomCode: string) {
  const room = await getRoomByCode(client, roomCode);
  if (!room) {
    return null;
  }

  const players = await getPlayersByRoomId(client, room.id);
  const game = await getGameByRoomId(client, room.id);

  let changed = false;
  changed = (await maybeMarkStaleDisconnected(client, room, players, game)) || changed;
  changed = (await maybeAutoResetPausedGame(client, room, game)) || changed;

  if (changed) {
    const freshRoom = await getRoomByCode(client, roomCode);
    if (!freshRoom) {
      return null;
    }
    return {
      room: freshRoom,
      players: await getPlayersByRoomId(client, freshRoom.id),
      game: await getGameByRoomId(client, freshRoom.id),
      events: await getEventsByRoomId(client, freshRoom.id),
    };
  }

  return {
    room,
    players,
    game,
    events: await getEventsByRoomId(client, room.id),
  };
}

function projectViewerState(
  room: RoomRecord,
  players: PlayerRecord[],
  game: GameRecord | null,
  events: QueryResultRow[],
  viewer: PlayerRecord | null,
): ViewerRoomState {
  const state = game?.state ?? null;
  const knownSpyIds = determineKnownSpies(viewer, players);
  const proposalTeam = state?.currentProposal ?? [];
  const missionTeamSize = state ? getMissionTeamSize(state) : null;
  const seatedPlayers = players.filter((player) => player.seat_index !== null);
  const missionMembers = new Set(proposalTeam);
  const leaderSeat = state?.leaderSeat ?? null;
  const sortedPlayers = [...players].sort((left, right) => {
    const leftSeat = left.seat_index ?? 999;
    const rightSeat = right.seat_index ?? 999;
    if (leftSeat !== rightSeat) {
      return leftSeat - rightSeat;
    }
    return left.display_name.localeCompare(right.display_name);
  });

  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      config: room.config,
      hostPlayerId: room.host_player_id,
      paused: game?.paused ?? false,
      disconnectDeadline: game?.disconnect_deadline?.toISOString() ?? null,
      winner: game?.winner ?? null,
    },
    viewer: {
      playerId: viewer?.id ?? null,
      displayName: viewer?.display_name ?? null,
      seatIndex: viewer?.seat_index ?? null,
      isHost: viewer?.id === room.host_player_id,
      isSpectator: viewer ? viewer.seat_index === null : true,
      role: viewer?.role ?? null,
      knownSpyIds,
      hasApprovalVoted: viewer ? Boolean(state?.approvalVotes[viewer.id]) : false,
      hasMissionCardSubmitted: viewer ? Boolean(state?.missionCards[viewer.id]) : false,
    },
    game: state,
    players: sortedPlayers.map((player) => ({
      id: player.id,
      displayName: player.display_name,
      seatIndex: player.seat_index,
      status: player.status,
      isHost: player.id === room.host_player_id,
      isLeader: player.seat_index !== null && player.seat_index === leaderSeat,
      isViewer: player.id === viewer?.id,
      isMissionMember: missionMembers.has(player.id),
      isKnownSpy: knownSpyIds.includes(player.id),
    })),
    eventLog: events.map((event) => ({
      id: String(event.id),
      kind: String(event.kind),
      message: String(event.message),
      createdAt: new Date(event.created_at as Date).toISOString(),
    })) satisfies EventLogEntry[],
    proposalTeam,
    missionTeamSize,
    seatedCount: seatedPlayers.length,
    spectatorCount: players.filter((player) => player.seat_index === null).length,
    approvalTotals: {
      submitted: Object.keys(state?.approvalVotes ?? {}).length,
      totalEligible: seatedPlayers.length,
    },
    missionTotals: {
      submitted: Object.keys(state?.missionCards ?? {}).length,
      totalEligible: proposalTeam.length,
    },
    serverTime: new Date().toISOString(),
  };
}

async function loadViewerByCookie(
  client: PoolClient,
  room: RoomRecord,
  sessionToken: string | null,
) {
  if (!sessionToken) {
    return null;
  }

  return findPlayerByTokenHash(client, room.id, hashToken(sessionToken));
}

export function getRoomCookieName(roomCode: string) {
  return roomCookieName(roomCode);
}

export async function getViewerRoomState(
  roomCodeInput: string,
  sessionToken: string | null,
) {
  await ensureSchema();
  const roomCode = parseRoomCode(roomCodeInput);
  const client = await getPool().connect();

  try {
    const hydrated = await hydrateRoomState(client, roomCode);
    if (!hydrated) {
      return null;
    }

    const viewer = await loadViewerByCookie(client, hydrated.room, sessionToken);
    return projectViewerState(
      hydrated.room,
      hydrated.players,
      hydrated.game,
      hydrated.events,
      viewer,
    );
  } finally {
    client.release();
  }
}

export async function createRoom(displayNameInput: string) {
  return withTransaction(async (client) => {
    const config = DEFAULT_CONFIG;
    validateConfig(config);

    let roomCode = generateRoomCode();
    while (await getRoomByCode(client, roomCode)) {
      roomCode = generateRoomCode();
    }

    const roomId = randomUUID();
    const playerId = randomUUID();
    const sessionToken = generateReconnectToken();
    const reconnectTokenHash = hashToken(sessionToken);
    const { displayName, normalizedName } = uniqueDisplayName(displayNameInput, []);

    await client.query(
      "INSERT INTO rooms (id, code, host_player_id, status, config) VALUES ($1, $2, $3, 'lobby', $4)",
      [roomId, roomCode, playerId, JSON.stringify(config)],
    );
    await client.query(
      `INSERT INTO players
        (id, room_id, seat_index, display_name, normalized_name, role, status, reconnect_token_hash)
       VALUES ($1, $2, 0, $3, $4, NULL, 'active', $5)`,
      [playerId, roomId, displayName, normalizedName, reconnectTokenHash],
    );
    await client.query(
      "INSERT INTO games (room_id, state, winner, paused, disconnect_deadline) VALUES ($1, NULL, NULL, FALSE, NULL)",
      [roomId],
    );
    await appendEvent(client, roomId, "room_created", `${displayName} created the room.`);

    return {
      roomCode,
      sessionToken,
    };
  });
}

export async function joinRoom(roomCodeInput: string, displayNameInput: string, asSpectator?: boolean) {
  const roomCode = parseRoomCode(roomCodeInput);

  return withTransaction(async (client) => {
    const hydrated = await hydrateRoomState(client, roomCode);
    if (!hydrated) {
      throw new Error("Room not found.");
    }

    const { room, players } = hydrated;
    const { displayName, normalizedName } = uniqueDisplayName(displayNameInput, players);
    const seatedPlayers = players.filter((player) => player.seat_index !== null);
    const isLateJoiner = room.status !== "lobby";
    const shouldSpectate = Boolean(asSpectator || isLateJoiner || seatedPlayers.length >= 6);

    const playerId = randomUUID();
    const sessionToken = generateReconnectToken();
    const reconnectTokenHash = hashToken(sessionToken);
    const seatIndex = shouldSpectate
      ? null
      : seatedPlayers.reduce((nextSeat, player) => {
          if (player.seat_index === nextSeat) {
            return nextSeat + 1;
          }
          return nextSeat;
        }, 0);

    await client.query(
      `INSERT INTO players
        (id, room_id, seat_index, display_name, normalized_name, role, status, reconnect_token_hash)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
      [
        playerId,
        room.id,
        seatIndex,
        displayName,
        normalizedName,
        shouldSpectate ? "spectator" : "active",
        reconnectTokenHash,
      ],
    );
    await appendEvent(
      client,
      room.id,
      shouldSpectate ? "spectator_joined" : "player_joined",
      shouldSpectate
        ? `${displayName} joined as a spectator.`
        : `${displayName} joined the room.`,
    );

    notifyRoom(room.code);
    return { roomCode: room.code, sessionToken };
  });
}

export async function markPresence(
  roomCodeInput: string,
  sessionToken: string,
  presence: "active" | "disconnect",
) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const hydrated = await hydrateRoomState(client, roomCode);
    if (!hydrated) {
      throw new Error("Room not found.");
    }

    const player = await findPlayerByTokenHash(client, hydrated.room.id, hashToken(sessionToken));
    if (!player) {
      return;
    }

    if (presence === "active") {
      await client.query(
        "UPDATE players SET status = CASE WHEN seat_index IS NULL THEN 'spectator' ELSE 'active' END, last_seen_at = NOW(), updated_at = NOW() WHERE id = $1",
        [player.id],
      );

      if (hydrated.room.status === "in_game") {
        const players = await getPlayersByRoomId(client, hydrated.room.id);
        const activeSeatedPlayers = players.filter(
          (currentPlayer) => currentPlayer.seat_index !== null && currentPlayer.status !== "disconnected",
        );
        const seatedPlayers = players.filter((currentPlayer) => currentPlayer.seat_index !== null);

        if (activeSeatedPlayers.length === seatedPlayers.length) {
          await client.query(
            "UPDATE games SET paused = FALSE, disconnect_deadline = NULL, updated_at = NOW() WHERE room_id = $1",
            [hydrated.room.id],
          );
        }
      }
    } else {
      const nextStatus: PlayerStatus = player.seat_index === null ? "spectator" : "disconnected";
      await client.query(
        "UPDATE players SET status = $2, updated_at = NOW() WHERE id = $1",
        [player.id, nextStatus],
      );

      if (player.seat_index !== null && hydrated.room.status === "in_game") {
        await client.query(
          "UPDATE games SET paused = TRUE, disconnect_deadline = NOW() + INTERVAL '5 minutes', updated_at = NOW() WHERE room_id = $1",
          [hydrated.room.id],
        );
      }
    }
  });

  notifyRoom(roomCode);
}

async function requireViewerPlayer(
  client: PoolClient,
  roomCodeInput: string,
  sessionToken: string,
) {
  const roomCode = parseRoomCode(roomCodeInput);
  const hydrated = await hydrateRoomState(client, roomCode);
  if (!hydrated) {
    throw new Error("Room not found.");
  }

  const viewer = await findPlayerByTokenHash(client, hydrated.room.id, hashToken(sessionToken));
  if (!viewer) {
    throw new Error("Session not found for this room.");
  }

  return {
    room: hydrated.room,
    players: hydrated.players,
    game: hydrated.game,
    viewer,
  };
}

export async function claimSeat(roomCodeInput: string, sessionToken: string) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const { room, players, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    if (room.status !== "lobby") {
      throw new Error("Seats cannot be claimed after the game starts.");
    }
    if (viewer.seat_index !== null) {
      return;
    }

    const seatedPlayers = players.filter((player) => player.seat_index !== null);
    if (seatedPlayers.length >= 6) {
      throw new Error("No player seats are available.");
    }

    const nextSeat = Array.from({ length: 6 }, (_, index) => index).find(
      (seatIndex) => !seatedPlayers.some((player) => player.seat_index === seatIndex),
    );

    if (nextSeat === undefined) {
      throw new Error("No player seats are available.");
    }

    await client.query(
      "UPDATE players SET seat_index = $2, status = 'active', updated_at = NOW() WHERE id = $1",
      [viewer.id, nextSeat],
    );
    await appendEvent(client, room.id, "seat_claimed", `${viewer.display_name} took an open seat.`);
  });

  notifyRoom(roomCode);
}

export async function updateRoomConfig(
  roomCodeInput: string,
  sessionToken: string,
  config: RoomConfig,
) {
  const roomCode = parseRoomCode(roomCodeInput);
  validateConfig(config);

  await withTransaction(async (client) => {
    const { room, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    if (viewer.id !== room.host_player_id) {
      throw new Error("Only the host can update room settings.");
    }
    if (room.status !== "lobby") {
      throw new Error("Room settings can only be changed in the lobby.");
    }

    await client.query(
      "UPDATE rooms SET config = $2, updated_at = NOW() WHERE id = $1",
      [room.id, JSON.stringify(config)],
    );
    await appendEvent(client, room.id, "config_updated", `${viewer.display_name} updated the room settings.`);
  });

  notifyRoom(roomCode);
}

export async function startGame(roomCodeInput: string, sessionToken: string) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const { room, players, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    if (viewer.id !== room.host_player_id) {
      throw new Error("Only the host can start the game.");
    }
    if (room.status !== "lobby") {
      throw new Error("The room is already in a game.");
    }

    const seatedPlayers = ensurePlayerCount(players);
    const config = room.config;
    validateConfig(config);

    for (const missionSize of config.missionSizes) {
      if (missionSize > seatedPlayers.length) {
        throw new Error("Mission sizes cannot exceed the seated player count.");
      }
    }

    const roleAssignments = assignRoles(seatedPlayers.map((player) => player.id));
    for (const assignment of roleAssignments) {
      await client.query("UPDATE players SET role = $2, updated_at = NOW() WHERE id = $1", [
        assignment.playerId,
        assignment.role,
      ]);
    }

    const gameState = createInitialGameState(config.missionSizes, seatedPlayers.length);
    await client.query(
      "UPDATE rooms SET status = 'in_game', updated_at = NOW() WHERE id = $1",
      [room.id],
    );
    await client.query(
      "UPDATE games SET state = $2, winner = NULL, paused = FALSE, disconnect_deadline = NULL, updated_at = NOW() WHERE room_id = $1",
      [room.id, JSON.stringify(gameState)],
    );
    await appendEvent(client, room.id, "game_started", `${viewer.display_name} started the game.`);
  });

  notifyRoom(roomCode);
}

function requireLiveGame(game: GameRecord | null) {
  if (!game?.state) {
    throw new Error("No active game was found for this room.");
  }

  return game.state;
}

async function updateWinnerIfNeeded(
  client: PoolClient,
  roomId: string,
  state: GameState,
) {
  if (state.phase !== "game_over") {
    return null;
  }

  const winner: PlayerRole = state.resistanceWins >= state.winTarget ? "resistance" : "spy";
  await client.query(
    "UPDATE rooms SET status = 'finished', updated_at = NOW() WHERE id = $1",
    [roomId],
  );
  await client.query(
    "UPDATE games SET winner = $2, updated_at = NOW() WHERE room_id = $1",
    [roomId, winner],
  );
  return winner;
}

export async function submitProposal(
  roomCodeInput: string,
  sessionToken: string,
  proposal: string[],
) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const { room, players, game, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    const state = requireLiveGame(game);
    if (state.phase !== "team_proposal") {
      if (state.phase === "mission_reveal") {
        advanceAfterReveal(state);
      } else {
        throw new Error("The room is not accepting a mission proposal right now.");
      }
    }

    if (viewer.seat_index !== state.leaderSeat) {
      throw new Error("Only the current leader can propose the mission team.");
    }

    const missionSize = getMissionTeamSize(state);
    if (!missionSize || proposal.length !== missionSize) {
      throw new Error("The proposed team size is invalid.");
    }

    const seatedIds = new Set(players.filter((player) => player.seat_index !== null).map((player) => player.id));
    const uniqueProposal = [...new Set(proposal)];
    if (uniqueProposal.length !== missionSize || uniqueProposal.some((playerId) => !seatedIds.has(playerId))) {
      throw new Error("The proposed team must use unique seated players.");
    }

    applyProposal(state, uniqueProposal);
    await client.query("UPDATE games SET state = $2, updated_at = NOW() WHERE room_id = $1", [
      room.id,
      JSON.stringify(state),
    ]);

    const teamNames = players
      .filter((player) => uniqueProposal.includes(player.id))
      .map((player) => player.display_name)
      .join(", ");
    await appendEvent(client, room.id, "proposal", `${viewer.display_name} proposed ${teamNames}.`);
  });

  notifyRoom(roomCode);
}

export async function submitTeamVote(
  roomCodeInput: string,
  sessionToken: string,
  vote: VoteChoice,
) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const { room, players, game, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    if (viewer.seat_index === null) {
      throw new Error("Spectators cannot vote.");
    }

    const state = requireLiveGame(game);
    if (state.phase !== "team_vote") {
      throw new Error("The room is not collecting approval votes right now.");
    }

    const result = submitApprovalVote(
      state,
      viewer.id,
      vote,
      players.filter((player) => player.seat_index !== null).length,
    );
    await client.query("UPDATE games SET state = $2, updated_at = NOW() WHERE room_id = $1", [
      room.id,
      JSON.stringify(state),
    ]);

    if (result) {
      await appendEvent(
        client,
        room.id,
        "vote_result",
        result.approved
          ? `The team was approved ${result.approvals}-${result.rejections}.`
          : `The team was rejected ${result.approvals}-${result.rejections}.`,
      );

      const winner = await updateWinnerIfNeeded(client, room.id, state);
      if (winner) {
        await appendEvent(client, room.id, "game_over", `${winner} won the game.`);
      }
    }
  });

  notifyRoom(roomCode);
}

export async function submitMissionChoice(
  roomCodeInput: string,
  sessionToken: string,
  card: MissionCard,
) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const { room, players, game, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    const state = requireLiveGame(game);
    if (state.phase !== "mission_action") {
      throw new Error("The room is not accepting mission cards right now.");
    }
    if (!state.currentProposal.includes(viewer.id)) {
      throw new Error("Only mission members can submit a card.");
    }

    const result = submitMissionCard(
      state,
      viewer.id,
      card,
      players.filter((player) => player.seat_index !== null).length,
    );
    await client.query("UPDATE games SET state = $2, updated_at = NOW() WHERE room_id = $1", [
      room.id,
      JSON.stringify(state),
    ]);

    if (result) {
      await appendEvent(
        client,
        room.id,
        "mission_result",
        `Mission ${result.missionIndex + 1} ${result.success ? "succeeded" : "failed"} with ${result.passes} pass and ${result.fails} fail.`,
      );
      const winner = await updateWinnerIfNeeded(client, room.id, state);
      if (winner) {
        await appendEvent(client, room.id, "game_over", `${winner} won the game.`);
      }
    }
  });

  notifyRoom(roomCode);
}

export async function restartRoom(roomCodeInput: string, sessionToken: string) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const { room, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    if (viewer.id !== room.host_player_id) {
      throw new Error("Only the host can restart the room.");
    }

    await resetRoomToLobby(client, room, `${viewer.display_name} restarted the room.`);
  });

  notifyRoom(roomCode);
}

export async function kickPlayer(
  roomCodeInput: string,
  sessionToken: string,
  targetPlayerId: string,
) {
  const roomCode = parseRoomCode(roomCodeInput);

  await withTransaction(async (client) => {
    const { room, players, viewer } = await requireViewerPlayer(client, roomCode, sessionToken);
    if (viewer.id !== room.host_player_id) {
      throw new Error("Only the host can remove players.");
    }

    const target = players.find((player) => player.id === targetPlayerId);
    if (!target) {
      throw new Error("Player not found.");
    }
    if (target.id === room.host_player_id) {
      throw new Error("The host cannot remove themself.");
    }

    await client.query("DELETE FROM players WHERE id = $1", [target.id]);

    if (room.status === "lobby") {
      await reseatPlayers(client, room.id);
      await appendEvent(client, room.id, "player_removed", `${viewer.display_name} removed ${target.display_name} from the room.`);
      return;
    }

    if (target.seat_index === null) {
      await appendEvent(client, room.id, "spectator_removed", `${viewer.display_name} removed spectator ${target.display_name}.`);
      return;
    }

    await reseatPlayers(client, room.id);
    await resetRoomToLobby(
      client,
      room,
      `${viewer.display_name} removed ${target.display_name}. The current game was returned to the lobby.`,
    );
  });

  notifyRoom(roomCode);
}
