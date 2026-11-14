import { describe, expect, test } from "bun:test";
import { createGame } from "./game";
import type { GameState } from "./game";
import { chooseBotAction } from "./bot";

function makeState(
  holeCards: GameState["players"][number]["holeCards"],
  currentBet = 0,
  botChips = 1_000,
  board: GameState["board"] = [],
): GameState {
  const game = createGame(["human", "bot"], () => 0);
  return {
    ...game,
    board,
    turn: "bot",
    players: game.players.map((player) =>
      player.id === "bot"
        ? { ...player, holeCards, roundBet: 0, chips: botChips }
        : { ...player, roundBet: currentBet },
    ),
  };
}

describe("chooseBotAction", () => {
  test("checks when there is no bet and the hand is not exceptionally strong", () => {
    const state = makeState([
      { rank: 2, suit: "clubs" },
      { rank: 7, suit: "diamonds" },
    ]);

    expect(chooseBotAction(state, "bot", () => 0.99)).toEqual({ type: "check" });
  });

  test("raises rarely with a strong starting hand when it can do so legally", () => {
    const state = makeState([
      { rank: 14, suit: "clubs" },
      { rank: 14, suit: "diamonds" },
    ]);

    expect(chooseBotAction(state, "bot", () => 0.01)).toEqual({
      type: "raise",
      amount: 20,
    });
    expect(chooseBotAction(state, "bot", () => 0.99)).toEqual({ type: "check" });
  });

  test("calls a small bet but folds when a call would use all remaining chips", () => {
    const weakHand = [
      { rank: 2, suit: "clubs" },
      { rank: 7, suit: "diamonds" },
    ] as const;

    expect(chooseBotAction(makeState(weakHand, 20), "bot")).toEqual({ type: "call" });
    expect(chooseBotAction(makeState(weakHand, 20, 20), "bot")).toEqual({ type: "fold" });
  });

  test("folds a weak hand when the call is expensive relative to its stack", () => {
    const state = makeState(
      [
        { rank: 2, suit: "clubs" },
        { rank: 7, suit: "diamonds" },
      ],
      80,
      100,
    );

    expect(chooseBotAction(state, "bot")).toEqual({ type: "fold" });
  });
});
