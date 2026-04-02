export type RoomStatus = "lobby" | "in_game" | "finished";

export type PlayerRole = "resistance" | "spy";

export type PlayerStatus = "active" | "spectator" | "disconnected";

export type VoteChoice = "approve" | "reject";

export type MissionCard = "pass" | "fail";

export type GamePhase =
  | "lobby"
  | "team_proposal"
  | "team_vote"
  | "mission_action"
  | "mission_reveal"
  | "game_over";

export type Winner = PlayerRole | null;

export type RoomConfig = {
  missionCount: number;
  missionSizes: number[];
};

export type MissionOutcome = {
  missionIndex: number;
  teamPlayerIds: string[];
  passes: number;
  fails: number;
  success: boolean;
};

export type GameState = {
  phase: GamePhase;
  leaderSeat: number;
  round: number;
  missionIndex: number;
  missionSizes: number[];
  currentProposal: string[];
  approvalVotes: Record<string, VoteChoice>;
  missionCards: Record<string, MissionCard>;
  missionHistory: MissionOutcome[];
  rejectionStreak: number;
  resistanceWins: number;
  spyWins: number;
  winTarget: number;
  reveal: MissionOutcome | null;
};

export type PlayerView = {
  id: string;
  displayName: string;
  seatIndex: number | null;
  status: PlayerStatus;
  isHost: boolean;
  isLeader: boolean;
  isViewer: boolean;
  isMissionMember: boolean;
  isKnownSpy: boolean;
};

export type EventLogEntry = {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
};

export type ViewerRoomState = {
  room: {
    id: string;
    code: string;
    status: RoomStatus;
    config: RoomConfig;
    hostPlayerId: string;
    paused: boolean;
    disconnectDeadline: string | null;
    winner: Winner;
  };
  viewer: {
    playerId: string | null;
    displayName: string | null;
    seatIndex: number | null;
    isHost: boolean;
    isSpectator: boolean;
    role: PlayerRole | null;
    knownSpyIds: string[];
    hasApprovalVoted: boolean;
    hasMissionCardSubmitted: boolean;
  };
  game: GameState | null;
  players: PlayerView[];
  eventLog: EventLogEntry[];
  proposalTeam: string[];
  missionTeamSize: number | null;
  seatedCount: number;
  spectatorCount: number;
  approvalTotals: {
    submitted: number;
    totalEligible: number;
  };
  missionTotals: {
    submitted: number;
    totalEligible: number;
  };
  serverTime: string;
};

export type RoomRecord = {
  id: string;
  code: string;
  host_player_id: string;
  status: RoomStatus;
  config: RoomConfig;
  created_at: Date;
  updated_at: Date;
};

export type PlayerRecord = {
  id: string;
  room_id: string;
  seat_index: number | null;
  display_name: string;
  normalized_name: string;
  role: PlayerRole | null;
  status: PlayerStatus;
  reconnect_token_hash: string;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type GameRecord = {
  room_id: string;
  state: GameState | null;
  winner: Winner;
  paused: boolean;
  disconnect_deadline: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type RoomEventRecord = {
  id: string;
  room_id: string;
  kind: string;
  message: string;
  created_at: Date;
};
