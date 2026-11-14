import type { GameStage, PlayerView } from "./game";

export type ActionAvailability = Readonly<{
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  callAmount: number;
  minimumRaiseTo: number;
  maximumRaiseTo: number;
}>;

const stageLabels: Record<GameStage, string> = {
  preflop: "ก่อนเปิดไพ่กลาง",
  flop: "ฟล็อป",
  turn: "เทิร์น",
  river: "ริเวอร์",
  showdown: "โชว์ดาวน์",
};

const handCategoryLabels: Readonly<Record<string, string>> = {
  "high-card": "ไพ่สูง",
  pair: "หนึ่งคู่",
  "two-pair": "สองคู่",
  "three-of-a-kind": "ตอง",
  straight: "เรียง",
  flush: "สี",
  "full-house": "ฟูลเฮาส์",
  "four-of-a-kind": "โฟร์การ์ด",
  "straight-flush": "สเตรทฟลัช",
};

const chipFormatter = new Intl.NumberFormat("th-TH");

export function formatChips(amount: number): string {
  return chipFormatter.format(amount);
}

export function getStageLabel(stage: GameStage): string {
  return stageLabels[stage];
}

export function getHandCategoryLabel(category: string | undefined): string | undefined {
  return category ? handCategoryLabels[category] : undefined;
}

export function getActionAvailability(
  state: PlayerView,
  playerId: string,
): ActionAvailability {
  const player = state.players.find(({ id }) => id === playerId);
  const isPlayersTurn =
    player !== undefined && state.turn === playerId && state.stage !== "showdown";
  const callAmount = player
    ? Math.max(0, state.currentBet - player.roundBet)
    : 0;
  const minimumRaiseTo = state.currentBet + state.minimumRaise;
  const maximumRaiseTo = player ? player.roundBet + player.chips - 1 : 0;

  return {
    canFold: isPlayersTurn,
    canCheck: isPlayersTurn && callAmount === 0,
    canCall: isPlayersTurn && callAmount > 0 && callAmount < (player?.chips ?? 0),
    canRaise: isPlayersTurn && maximumRaiseTo >= minimumRaiseTo,
    callAmount,
    minimumRaiseTo,
    maximumRaiseTo,
  };
}

export function getReconnectDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(1_000 * 2 ** Math.min(safeAttempt, 4), 15_000);
}
