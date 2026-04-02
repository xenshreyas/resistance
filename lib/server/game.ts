import {
  type GameState,
  type MissionCard,
  type MissionOutcome,
  type PlayerRole,
  type VoteChoice,
} from "@/lib/types";

function shuffle<T>(items: T[]) {
  const clone = [...items];

  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }

  return clone;
}

export function getSpyCount(playerCount: number) {
  if (playerCount === 4) {
    return 1;
  }

  if (playerCount === 5 || playerCount === 6) {
    return 2;
  }

  throw new Error("Resistance requires 4 to 6 seated players.");
}

export function assignRoles(playerIds: string[]) {
  const spyCount = getSpyCount(playerIds.length);
  const shuffled = shuffle(playerIds);
  const spies = new Set(shuffled.slice(0, spyCount));

  return playerIds.map((playerId) => ({
    playerId,
    role: (spies.has(playerId) ? "spy" : "resistance") as PlayerRole,
  }));
}

export function createInitialGameState(missionSizes: number[], seatedCount: number): GameState {
  return {
    phase: "team_proposal",
    leaderSeat: Math.floor(Math.random() * seatedCount),
    round: 1,
    missionIndex: 0,
    missionSizes,
    currentProposal: [],
    approvalVotes: {},
    missionCards: {},
    missionHistory: [],
    rejectionStreak: 0,
    resistanceWins: 0,
    spyWins: 0,
    winTarget: Math.ceil(missionSizes.length / 2),
    reveal: null,
  };
}

export function rotateLeader(state: GameState, seatedCount: number) {
  state.leaderSeat = (state.leaderSeat + 1) % seatedCount;
}

export function getMissionTeamSize(state: GameState) {
  return state.missionSizes[state.missionIndex] ?? null;
}

export function applyProposal(state: GameState, proposal: string[]) {
  state.currentProposal = proposal;
  state.approvalVotes = {};
  state.missionCards = {};
  state.reveal = null;
  state.phase = "team_vote";
}

export function submitApprovalVote(
  state: GameState,
  playerId: string,
  vote: VoteChoice,
  seatedCount: number,
) {
  state.approvalVotes[playerId] = vote;

  if (Object.keys(state.approvalVotes).length < seatedCount) {
    return null;
  }

  const approvals = Object.values(state.approvalVotes).filter(
    (choice) => choice === "approve",
  ).length;
  const rejections = seatedCount - approvals;

  if (approvals > rejections) {
    state.phase = "mission_action";
    state.rejectionStreak = 0;
    return { approved: true, approvals, rejections };
  }

  state.phase = "team_proposal";
  state.currentProposal = [];
  state.approvalVotes = {};
  state.rejectionStreak += 1;
  state.round += 1;
  rotateLeader(state, seatedCount);

  if (state.rejectionStreak >= 5) {
    state.spyWins = state.winTarget;
    state.phase = "game_over";
  }

  return { approved: false, approvals, rejections };
}

export function submitMissionCard(
  state: GameState,
  playerId: string,
  card: MissionCard,
  seatedCount: number,
) {
  state.missionCards[playerId] = card;

  if (Object.keys(state.missionCards).length < state.currentProposal.length) {
    return null;
  }

  const passes = Object.values(state.missionCards).filter(
    (choice) => choice === "pass",
  ).length;
  const fails = state.currentProposal.length - passes;
  const success = fails === 0;
  const outcome: MissionOutcome = {
    missionIndex: state.missionIndex,
    teamPlayerIds: [...state.currentProposal],
    passes,
    fails,
    success,
  };

  state.missionHistory.push(outcome);
  state.reveal = outcome;
  state.phase = "mission_reveal";

  if (success) {
    state.resistanceWins += 1;
  } else {
    state.spyWins += 1;
  }

  if (state.resistanceWins >= state.winTarget || state.spyWins >= state.winTarget) {
    state.phase = "game_over";
    return outcome;
  }

  state.missionIndex += 1;
  state.round += 1;
  state.currentProposal = [];
  state.approvalVotes = {};
  state.missionCards = {};
  rotateLeader(state, seatedCount);
  return outcome;
}

export function advanceAfterReveal(state: GameState) {
  if (state.phase !== "mission_reveal") {
    return;
  }

  state.phase = "team_proposal";
  state.reveal = state.missionHistory[state.missionHistory.length - 1] ?? null;
}
