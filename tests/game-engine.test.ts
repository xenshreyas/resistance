import { describe, expect, it } from "vitest";

import {
  assignRoles,
  createInitialGameState,
  submitApprovalVote,
  submitMissionCard,
} from "../lib/server/game";

describe("game engine", () => {
  it("assigns standard spy counts", () => {
    expect(assignRoles(["a", "b", "c", "d"]).filter((player) => player.role === "spy")).toHaveLength(1);
    expect(assignRoles(["a", "b", "c", "d", "e"]).filter((player) => player.role === "spy")).toHaveLength(2);
    expect(assignRoles(["a", "b", "c", "d", "e", "f"]).filter((player) => player.role === "spy")).toHaveLength(2);
  });

  it("uses a majority win target for custom mission counts", () => {
    const state = createInitialGameState([2, 3, 3, 4, 4, 5, 5], 6);
    expect(state.winTarget).toBe(4);
  });

  it("makes spies win after five rejected proposals", () => {
    const state = createInitialGameState([2, 2, 3, 2, 3], 5);
    state.currentProposal = ["a", "b"];
    state.phase = "team_vote";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      ["a", "b", "c", "d", "e"].forEach((playerId) => {
        submitApprovalVote(state, playerId, "reject", 5);
      });

      if (attempt < 4) {
        state.currentProposal = ["a", "b"];
        state.phase = "team_vote";
      }
    }

    expect(state.phase).toBe("game_over");
    expect(state.spyWins).toBe(state.winTarget);
  });

  it("records success and failure mission outcomes", () => {
    const successState = createInitialGameState([2, 2, 3], 4);
    successState.phase = "mission_action";
    successState.currentProposal = ["a", "b"];

    submitMissionCard(successState, "a", "pass", 4);
    const successOutcome = submitMissionCard(successState, "b", "pass", 4);

    expect(successOutcome?.success).toBe(true);
    expect(successState.resistanceWins).toBe(1);
    expect(successState.phase).toBe("mission_reveal");

    const failState = createInitialGameState([2, 2, 3], 4);
    failState.phase = "mission_action";
    failState.currentProposal = ["a", "b"];

    submitMissionCard(failState, "a", "pass", 4);
    const failOutcome = submitMissionCard(failState, "b", "fail", 4);

    expect(failOutcome?.success).toBe(false);
    expect(failState.spyWins).toBe(1);
    expect(failState.phase).toBe("mission_reveal");
  });
});
