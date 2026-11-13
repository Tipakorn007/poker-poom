import { describe, expect, test } from "bun:test";
import { createDeck } from "./cards";
import type { Card } from "./cards";
import {
  applyAction,
  createGame,
  getPlayerView,
  type GameState,
} from "./game";

function rigGame(
  firstHand: readonly Card[],
  secondHand: readonly Card[],
  board: readonly Card[],
): GameState {
  const used = [...firstHand, ...secondHand, ...board];
  const usedIds = new Set(used.map(({ suit, rank }) => `${suit}-${rank}`));
  const remaining = createDeck().filter(
    ({ suit, rank }) => !usedIds.has(`${suit}-${rank}`),
  );
  const state = createGame(["A", "B"], () => 0);

  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      holeCards: player.id === "A" ? firstHand : secondHand,
    })),
    board: [],
    deck: [...board, ...remaining],
  };
}

function checkUntilStage(state: GameState, stage: GameState["stage"]): GameState {
  let current = state;
  while (current.stage !== stage) {
    const playerId = current.turn!;
    current = applyAction(current, playerId, { type: "check" });
  }
  return current;
}

describe("createGame", () => {
  test("deals private cards and starts preflop to the left of the dealer", () => {
    const state = createGame(["A", "B", "C"], () => 0);

    expect(state.stage).toBe("preflop");
    expect(state.dealerButton).toBe("A");
    expect(state.turn).toBe("B");
    expect(state.players.map(({ holeCards }) => holeCards)).toHaveLength(3);
    expect(state.players.every(({ holeCards }) => holeCards.length === 2)).toBe(true);
    expect(state.deck).toHaveLength(46);
  });
});

describe("applyAction", () => {
  test("rejects actions out of turn", () => {
    const state = createGame(["A", "B"], () => 0);

    expect(() => applyAction(state, "A", { type: "check" })).toThrow("not this player's turn");
  });

  test("does not end a round before everyone acts or bets are matched", () => {
    const initial = createGame(["A", "B"], () => 0);
    const afterCheck = applyAction(initial, "B", { type: "check" });
    expect(afterCheck.stage).toBe("preflop");
    expect(afterCheck.actedPlayers).toEqual(["B"]);

    const afterRaise = applyAction(initial, "B", { type: "raise", amount: 40 });
    expect(afterRaise.stage).toBe("preflop");
    expect(afterRaise.turn).toBe("A");
    expect(afterRaise.pot).toBe(40);
    expect(afterRaise.players.find(({ id }) => id === "B")?.roundBet).toBe(40);
  });

  test("requires a call instead of checking when behind a bet", () => {
    const state = createGame(["A", "B"], () => 0);
    const raised = applyAction(state, "B", { type: "raise", amount: 40 });

    expect(() => applyAction(raised, "A", { type: "check" })).toThrow("Cannot check");
  });

  test("rejects a raise below the minimum increase", () => {
    const state = createGame(["A", "B"], () => 0);
    const raised = applyAction(state, "B", { type: "raise", amount: 40 });

    expect(() =>
      applyAction(raised, "A", { type: "raise", amount: 59 }),
    ).toThrow("at least 20");
  });

  test("requires everyone to act again after a raise", () => {
    let state = createGame(["A", "B", "C"], () => 0);
    state = applyAction(state, "B", { type: "check" });
    state = applyAction(state, "C", { type: "check" });
    state = applyAction(state, "A", { type: "raise", amount: 20 });

    expect(state.stage).toBe("preflop");
    expect(state.turn).toBe("B");
    expect(state.actedPlayers).toEqual(["A"]);
  });

  test("rejects a call or raise that would use all remaining chips", () => {
    let state = createGame(["A", "B"], () => 0);
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === "B" ? { ...player, chips: 20 } : player,
      ),
    };

    expect(() =>
      applyAction(state, "B", { type: "raise", amount: 20 }),
    ).toThrow("cannot use all");
  });

  test("moves through every street and awards the pot to the best hand", () => {
    let state = rigGame(
      [
        { rank: 6, suit: "clubs" },
        { rank: 6, suit: "diamonds" },
      ],
      [
        { rank: 7, suit: "clubs" },
        { rank: 7, suit: "diamonds" },
      ],
      [
        { rank: 2, suit: "clubs" },
        { rank: 3, suit: "diamonds" },
        { rank: 4, suit: "hearts" },
        { rank: 10, suit: "spades" },
        { rank: 9, suit: "clubs" },
      ],
    );

    state = applyAction(state, "B", { type: "raise", amount: 40 });
    state = applyAction(state, "A", { type: "call" });
    expect(state.stage).toBe("flop");
    expect(state.board).toHaveLength(3);

    state = checkUntilStage(state, "turn");
    expect(state.board).toHaveLength(4);
    state = checkUntilStage(state, "river");
    expect(state.board).toHaveLength(5);
    state = checkUntilStage(state, "showdown");

    expect(state.winners).toEqual(["B"]);
    expect(state.players.find(({ id }) => id === "B")?.chips).toBe(1_040);
    expect(state.pot).toBe(0);
    expect(state.showdownRevealed).toBe(true);
  });

  test("awards the pot immediately when all other players fold without revealing cards", () => {
    let state = createGame(["A", "B"], () => 0);
    state = applyAction(state, "B", { type: "raise", amount: 40 });
    state = applyAction(state, "A", { type: "call" });
    state = applyAction(state, "B", { type: "fold" });

    expect(state.stage).toBe("showdown");
    expect(state.winners).toEqual(["A"]);
    expect(state.players.find(({ id }) => id === "A")?.chips).toBe(1_040);
    expect(state.board).toHaveLength(3);
    expect(state.showdownRevealed).toBe(false);
  });

  test("splits a tied pot and awards the odd chip left of the dealer", () => {
    const state = rigGame(
      [
        { rank: 6, suit: "clubs" },
        { rank: 9, suit: "clubs" },
      ],
      [
        { rank: 6, suit: "diamonds" },
        { rank: 9, suit: "diamonds" },
      ],
      [
        { rank: 2, suit: "clubs" },
        { rank: 3, suit: "diamonds" },
        { rank: 4, suit: "hearts" },
        { rank: 5, suit: "spades" },
        { rank: 10, suit: "hearts" },
      ],
    );
    let riverState: GameState = {
      ...state,
      board: [
        { rank: 2, suit: "clubs" },
        { rank: 3, suit: "diamonds" },
        { rank: 4, suit: "hearts" },
        { rank: 5, suit: "spades" },
      ],
      deck: [
        { rank: 10, suit: "hearts" },
        ...state.deck.slice(1),
      ],
      stage: "river",
      turn: "B",
      pot: 5,
    };

    riverState = applyAction(riverState, "B", { type: "check" });
    riverState = applyAction(riverState, "A", { type: "check" });

    expect(riverState.winners).toEqual(["A", "B"]);
    expect(riverState.players.find(({ id }) => id === "A")?.chips).toBe(1_002);
    expect(riverState.players.find(({ id }) => id === "B")?.chips).toBe(1_003);
    expect(riverState.pot).toBe(0);
  });
});

describe("getPlayerView", () => {
  test("does not expose other players' cards or the remaining deck", () => {
    const state = createGame(["A", "B"], () => 0);
    const view = getPlayerView(state, "A");
    const serialized = JSON.stringify(view);
    const hiddenCards = state.players.find(({ id }) => id === "B")!.holeCards;

    expect(view.players.find(({ id }) => id === "A")?.holeCards).toHaveLength(2);
    expect(view.players.find(({ id }) => id === "B")?.holeCards).toBeUndefined();
    expect("deck" in view).toBe(false);
    expect(serialized).not.toContain(JSON.stringify(hiddenCards));
  });

  test("reveals only non-folded hands at showdown", () => {
    const state = createGame(["A", "B", "C"], () => 0);
    const showdown: GameState = {
      ...state,
      stage: "showdown",
      showdownRevealed: true,
      players: state.players.map((player) =>
        player.id === "C" ? { ...player, folded: true } : player,
      ),
    };

    const view = getPlayerView(showdown, "A");

    expect(view.players.every(({ id, holeCards, folded }) =>
      folded ? holeCards === undefined : holeCards?.length === 2,
    )).toBe(true);
  });
});
