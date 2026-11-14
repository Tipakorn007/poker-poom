import { describe, expect, test } from "bun:test";
import type { PlayerView } from "./game";
import {
  formatChips,
  getActionAvailability,
  getHandCategoryLabel,
  getReconnectDelay,
  getStageLabel,
} from "./ui-model";

const state: PlayerView = {
  playerId: "A",
  players: [
    { id: "A", chips: 980, roundBet: 20, folded: false, holeCards: [] },
    { id: "B", chips: 960, roundBet: 40, folded: false },
  ],
  board: [],
  pot: 60,
  stage: "preflop",
  turn: "A",
  dealerButton: "B",
  minimumRaise: 20,
  currentBet: 40,
  winners: [],
  showdownRevealed: false,
};

describe("UI formatting", () => {
  test("formats chip amounts and stage/category labels", () => {
    expect(formatChips(1234567)).toBe("1,234,567");
    expect(getStageLabel("river")).toBe("ริเวอร์");
    expect(getHandCategoryLabel("straight-flush")).toBe("สเตรทฟลัช");
    expect(getHandCategoryLabel(undefined)).toBeUndefined();
  });
});

describe("server-driven action availability", () => {
  test("enables only actions allowed by the current server view", () => {
    expect(getActionAvailability(state, "A")).toEqual({
      canFold: true,
      canCheck: false,
      canCall: true,
      canRaise: true,
      callAmount: 20,
      minimumRaiseTo: 60,
      maximumRaiseTo: 999,
    });
    expect(getActionAvailability(state, "B").canFold).toBe(false);
  });

  test("disables call when it would use the player's last chip", () => {
    const shortStack: PlayerView = {
      ...state,
      players: state.players.map((player) =>
        player.id === "A" ? { ...player, chips: 20 } : player,
      ),
    };

    expect(getActionAvailability(shortStack, "A").canCall).toBe(false);
    expect(getActionAvailability(shortStack, "A").canRaise).toBe(false);
  });
});

describe("reconnect backoff", () => {
  test("spaces retries increasingly and caps the wait", () => {
    expect([0, 1, 2, 3, 4, 5].map(getReconnectDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);
  });
});
