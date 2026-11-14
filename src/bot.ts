import type { Card } from "./cards";
import { evaluateHand } from "./evaluator";
import type { GameState, PlayerAction } from "./game";

const handCategories = [
  "high-card",
  "pair",
  "two-pair",
  "three-of-a-kind",
  "straight",
  "flush",
  "full-house",
  "four-of-a-kind",
  "straight-flush",
] as const;

function getHandStrength(holeCards: readonly Card[], board: readonly Card[]): number {
  if (board.length >= 3) {
    const score = evaluateHand([...holeCards, ...board]);
    const categoryStrength = handCategories.indexOf(score.category) / 8;
    const topCardStrength = (score.tiebreakers[0] ?? 2) / 140;
    return Math.min(1, categoryStrength + topCardStrength * 0.08);
  }

  const [first, second] = holeCards;
  if (!first || !second) {
    return 0;
  }

  const high = Math.max(first.rank, second.rank);
  const low = Math.min(first.rank, second.rank);
  if (high === low) {
    return 0.65 + high * 0.02;
  }

  const suited = first.suit === second.suit ? 0.04 : 0;
  const connected = high - low <= 2 ? 0.04 : 0;
  return Math.min(0.75, 0.28 + (high - 2) * 0.018 + (low - 2) * 0.01 + suited + connected);
}

function getCallTarget(players: GameState["players"]): number {
  return Math.max(...players.filter(({ folded }) => !folded).map(({ roundBet }) => roundBet));
}

export function chooseBotAction(
  state: GameState,
  playerId: string,
  random: () => number = Math.random,
): PlayerAction {
  if (state.turn !== playerId || state.stage === "showdown") {
    throw new Error("It is not this bot's turn");
  }

  const player = state.players.find(({ id }) => id === playerId);
  if (!player || player.folded) {
    throw new Error("Bot player is not active in this hand");
  }

  const currentBet = getCallTarget(state.players);
  const amountToCall = currentBet - player.roundBet;
  const strength = getHandStrength(player.holeCards, state.board);

  if (amountToCall <= 0) {
    if (strength >= 0.78) {
      const chance = random();
      if (!Number.isFinite(chance) || chance < 0 || chance >= 1) {
        throw new RangeError("Random source must return a number from 0 to less than 1");
      }

      const raiseTo = currentBet + state.minimumRaise;
      if (
        chance < 0.04 &&
        raiseTo - player.roundBet < player.chips
      ) {
        return { type: "raise", amount: raiseTo };
      }
    }
    return { type: "check" };
  }

  if (amountToCall >= player.chips) {
    return { type: "fold" };
  }

  const callRatio = amountToCall / player.chips;
  const callLimit = 0.1 + strength * 0.55;
  return callRatio <= callLimit ? { type: "call" } : { type: "fold" };
}
