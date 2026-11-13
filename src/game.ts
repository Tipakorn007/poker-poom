import { createDeck, shuffleDeck } from "./cards";
import type { Card } from "./cards";
import { compare, evaluateHand } from "./evaluator";

export type PlayerId = string;

export type GameStage = "preflop" | "flop" | "turn" | "river" | "showdown";

export type PlayerAction =
  | Readonly<{ type: "fold" }>
  | Readonly<{ type: "check" }>
  | Readonly<{ type: "call" }>
  | Readonly<{ type: "raise"; amount: number }>;

export type GamePlayer = Readonly<{
  id: PlayerId;
  holeCards: readonly Card[];
  chips: number;
  roundBet: number;
  folded: boolean;
}>;

export type GameState = Readonly<{
  deck: readonly Card[];
  players: readonly GamePlayer[];
  board: readonly Card[];
  pot: number;
  stage: GameStage;
  turn: PlayerId | null;
  dealerButton: PlayerId;
  actedPlayers: readonly PlayerId[];
  minimumRaise: number;
  winners: readonly PlayerId[];
  showdownRevealed: boolean;
}>;

export type PlayerViewPlayer = Readonly<{
  id: PlayerId;
  chips: number;
  roundBet: number;
  folded: boolean;
  holeCards?: readonly Card[];
}>;

export type PlayerView = Readonly<{
  playerId: PlayerId;
  players: readonly PlayerViewPlayer[];
  board: readonly Card[];
  pot: number;
  stage: GameStage;
  turn: PlayerId | null;
  dealerButton: PlayerId;
  minimumRaise: number;
  currentBet: number;
  winners: readonly PlayerId[];
  showdownRevealed: boolean;
}>;

export const STARTING_CHIPS = 1_000;
export const MINIMUM_RAISE = 20;
const MAX_PLAYERS = 10;

export function createGame(
  playerIds: readonly PlayerId[],
  random: () => number = Math.random,
): GameState {
  if (playerIds.length < 2 || playerIds.length > MAX_PLAYERS) {
    throw new RangeError(`A game must have between 2 and ${MAX_PLAYERS} players`);
  }
  if (playerIds.some((id) => id.trim().length === 0)) {
    throw new TypeError("Player IDs cannot be empty");
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new TypeError("Player IDs must be unique");
  }

  const shuffled = shuffleDeck(createDeck(), random);
  const holeCards = playerIds.map((): Card[] => []);
  let deckIndex = 0;

  for (let cardNumber = 0; cardNumber < 2; cardNumber++) {
    for (const hand of holeCards) {
      hand.push(shuffled[deckIndex]!);
      deckIndex++;
    }
  }

  const players = playerIds.map((id, index) => ({
    id,
    holeCards: holeCards[index]!,
    chips: STARTING_CHIPS,
    roundBet: 0,
    folded: false,
  }));

  return {
    deck: shuffled.slice(deckIndex),
    players,
    board: [],
    pot: 0,
    stage: "preflop",
    turn: playerIds[1]!,
    dealerButton: playerIds[0]!,
    actedPlayers: [],
    minimumRaise: MINIMUM_RAISE,
    winners: [],
    showdownRevealed: false,
  };
}

function getActivePlayers(players: readonly GamePlayer[]): GamePlayer[] {
  return players.filter((player) => !player.folded);
}

function getCurrentBet(players: readonly GamePlayer[]): number {
  return Math.max(...getActivePlayers(players).map(({ roundBet }) => roundBet));
}

function getPlayerIndex(players: readonly GamePlayer[], playerId: PlayerId): number {
  const index = players.findIndex((player) => player.id === playerId);
  if (index === -1) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return index;
}

function getNextActivePlayer(
  players: readonly GamePlayer[],
  afterPlayerId: PlayerId,
): PlayerId {
  const start = getPlayerIndex(players, afterPlayerId);

  for (let offset = 1; offset <= players.length; offset++) {
    const player = players[(start + offset) % players.length]!;
    if (!player.folded) {
      return player.id;
    }
  }

  throw new Error("Cannot find an active player");
}

function awardFoldWin(state: GameState, players: readonly GamePlayer[]): GameState {
  const [winner] = getActivePlayers(players);
  if (!winner) {
    throw new Error("A game cannot finish without an active player");
  }

  return {
    ...state,
    players: players.map((player) =>
      player.id === winner.id ? { ...player, chips: player.chips + state.pot } : player,
    ),
    pot: 0,
    stage: "showdown",
    turn: null,
    winners: [winner.id],
    showdownRevealed: false,
  };
}

function awardShowdown(state: GameState, players: readonly GamePlayer[]): GameState {
  const activePlayers = getActivePlayers(players);
  const scoredPlayers = activePlayers.map((player) => ({
    player,
    score: evaluateHand([...player.holeCards, ...state.board]),
  }));
  let bestScore = scoredPlayers[0]!.score;
  let winners = [scoredPlayers[0]!.player.id];

  for (const { player, score } of scoredPlayers.slice(1)) {
    const result = compare(score, bestScore);
    if (result > 0) {
      bestScore = score;
      winners = [player.id];
    } else if (result === 0) {
      winners.push(player.id);
    }
  }

  const baseShare = Math.floor(state.pot / winners.length);
  let oddChips = state.pot % winners.length;
  const dealerIndex = getPlayerIndex(players, state.dealerButton);
  const winnerOrder: PlayerId[] = [];

  for (let offset = 1; offset <= players.length; offset++) {
    const player = players[(dealerIndex + offset) % players.length]!;
    if (winners.includes(player.id)) {
      winnerOrder.push(player.id);
    }
  }

  const payouts = new Map(winners.map((winnerId) => [winnerId, baseShare]));
  for (const winnerId of winnerOrder) {
    if (oddChips === 0) {
      break;
    }
    payouts.set(winnerId, payouts.get(winnerId)! + 1);
    oddChips--;
  }

  return {
    ...state,
    players: players.map((player) => {
      const payout = payouts.get(player.id) ?? 0;
      return payout > 0 ? { ...player, chips: player.chips + payout } : player;
    }),
    pot: 0,
    stage: "showdown",
    turn: null,
    winners,
    showdownRevealed: true,
  };
}

function advanceStage(state: GameState, players: readonly GamePlayer[]): GameState {
  const resetPlayers = players.map((player) => ({ ...player, roundBet: 0 }));

  if (state.stage === "river") {
    return awardShowdown({ ...state, players: resetPlayers }, resetPlayers);
  }

  const cardsToReveal = state.stage === "preflop" ? 3 : 1;
  const nextStage: GameStage =
    state.stage === "preflop" ? "flop" : state.stage === "flop" ? "turn" : "river";
  const revealedCards = state.deck.slice(0, cardsToReveal);
  if (revealedCards.length !== cardsToReveal) {
    throw new Error("Not enough cards remain in the deck");
  }

  return {
    ...state,
    deck: state.deck.slice(cardsToReveal),
    players: resetPlayers,
    board: [...state.board, ...revealedCards],
    stage: nextStage,
    turn: getNextActivePlayer(resetPlayers, state.dealerButton),
    actedPlayers: [],
  };
}

function completeAction(
  state: GameState,
  players: readonly GamePlayer[],
  actedPlayers: readonly PlayerId[],
  actingPlayerId: PlayerId,
): GameState {
  const activePlayers = getActivePlayers(players);
  if (activePlayers.length === 1) {
    return awardFoldWin(state, players);
  }

  const currentBet = getCurrentBet(players);
  const allBetsMatched = activePlayers.every((player) => player.roundBet === currentBet);
  const acted = new Set(actedPlayers);
  const everyoneActed = activePlayers.every((player) => acted.has(player.id));

  if (allBetsMatched && everyoneActed) {
    return advanceStage({ ...state, players }, players);
  }

  return {
    ...state,
    players,
    actedPlayers: [...acted],
    turn: getNextActivePlayer(players, actingPlayerId),
  };
}

export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: PlayerAction,
): GameState {
  if (state.stage === "showdown") {
    throw new Error("The game is already over");
  }
  if (state.turn !== playerId) {
    throw new Error("It is not this player's turn");
  }

  const playerIndex = getPlayerIndex(state.players, playerId);
  const player = state.players[playerIndex]!;
  if (player.folded) {
    throw new Error("A folded player cannot act");
  }

  const currentBet = getCurrentBet(state.players);
  let players: GamePlayer[];
  let actedPlayers: PlayerId[];

  switch (action.type) {
    case "fold":
      players = state.players.map((candidate) =>
        candidate.id === playerId ? { ...candidate, folded: true } : candidate,
      );
      actedPlayers = [...state.actedPlayers, playerId];
      break;

    case "check":
      if (player.roundBet < currentBet) {
        throw new Error("Cannot check while there is a bet to call");
      }
      players = [...state.players];
      actedPlayers = [...state.actedPlayers, playerId];
      break;

    case "call": {
      const amountToCall = currentBet - player.roundBet;
      if (amountToCall <= 0) {
        throw new Error("There is no bet to call");
      }
      if (amountToCall >= player.chips) {
        throw new Error("Calling cannot use all of a player's remaining chips");
      }

      players = state.players.map((candidate) =>
        candidate.id === playerId
          ? {
              ...candidate,
              chips: candidate.chips - amountToCall,
              roundBet: currentBet,
            }
          : candidate,
      );
      actedPlayers = [...state.actedPlayers, playerId];
      break;
    }

    case "raise": {
      if (!Number.isInteger(action.amount) || action.amount <= currentBet) {
        throw new Error("A raise must be an integer greater than the current bet");
      }
      if (action.amount - currentBet < state.minimumRaise) {
        throw new Error(`A raise must increase the current bet by at least ${state.minimumRaise}`);
      }

      const amountToAdd = action.amount - player.roundBet;
      if (amountToAdd >= player.chips) {
        throw new Error("A raise cannot use all of a player's remaining chips");
      }

      players = state.players.map((candidate) =>
        candidate.id === playerId
          ? {
              ...candidate,
              chips: candidate.chips - amountToAdd,
              roundBet: action.amount,
            }
          : candidate,
      );
      actedPlayers = [playerId];
      break;
    }
  }

  const pot =
    action.type === "call"
      ? state.pot + currentBet - player.roundBet
      : action.type === "raise"
        ? state.pot + action.amount - player.roundBet
        : state.pot;

  return completeAction(
    { ...state, pot },
    players,
    actedPlayers,
    playerId,
  );
}

export function getPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  return {
    playerId,
    players: state.players.map((player) => ({
      id: player.id,
      chips: player.chips,
      roundBet: player.roundBet,
      folded: player.folded,
      ...(player.id === playerId || (state.showdownRevealed && !player.folded)
        ? { holeCards: [...player.holeCards] }
        : {}),
    })),
    board: [...state.board],
    pot: state.pot,
    stage: state.stage,
    turn: state.turn,
    dealerButton: state.dealerButton,
    minimumRaise: state.minimumRaise,
    currentBet: getCurrentBet(state.players),
    winners: [...state.winners],
    showdownRevealed: state.showdownRevealed,
  };
}
