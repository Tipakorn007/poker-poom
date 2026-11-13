import type { Card } from "./cards";

export type HandCategory =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush";

export type HandScore = Readonly<{
  category: HandCategory;
  tiebreakers: readonly number[];
}>;

export type ComparisonResult = -1 | 0 | 1;

const categoryOrder: readonly HandCategory[] = [
  "high-card",
  "pair",
  "two-pair",
  "three-of-a-kind",
  "straight",
  "flush",
  "full-house",
  "four-of-a-kind",
  "straight-flush",
];

type RankGroup = {
  rank: number;
  count: number;
};

function getStraightHighCard(ranks: readonly number[]): number | undefined {
  const distinctRanks = [...new Set(ranks)].sort((a, b) => b - a);

  if (distinctRanks.length !== 5) {
    return undefined;
  }

  if (distinctRanks[0]! - distinctRanks[4]! === 4) {
    return distinctRanks[0];
  }

  if (distinctRanks.join(",") === "14,5,4,3,2") {
    return 5;
  }

  return undefined;
}

function getRankGroups(ranks: readonly number[]): RankGroup[] {
  const counts = new Map<number, number>();

  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }

  return [...counts].map(([rank, count]) => ({ rank, count })).sort(
    (a, b) => b.count - a.count || b.rank - a.rank,
  );
}

function scoreFiveCards(cards: readonly Card[]): HandScore {
  const ranks = cards.map(({ rank }) => rank).sort((a, b) => b - a);
  const groups = getRankGroups(ranks);
  const isFlush = cards.every(({ suit }) => suit === cards[0]!.suit);
  const straightHighCard = getStraightHighCard(ranks);

  if (isFlush && straightHighCard !== undefined) {
    return { category: "straight-flush", tiebreakers: [straightHighCard] };
  }

  if (groups[0]!.count === 4) {
    return {
      category: "four-of-a-kind",
      tiebreakers: [groups[0]!.rank, groups[1]!.rank],
    };
  }

  if (groups[0]!.count === 3 && groups[1]!.count === 2) {
    return {
      category: "full-house",
      tiebreakers: [groups[0]!.rank, groups[1]!.rank],
    };
  }

  if (isFlush) {
    return { category: "flush", tiebreakers: ranks };
  }

  if (straightHighCard !== undefined) {
    return { category: "straight", tiebreakers: [straightHighCard] };
  }

  if (groups[0]!.count === 3) {
    return {
      category: "three-of-a-kind",
      tiebreakers: [groups[0]!.rank, ...groups.slice(1).map(({ rank }) => rank)],
    };
  }

  if (groups[0]!.count === 2 && groups[1]!.count === 2) {
    return {
      category: "two-pair",
      tiebreakers: [
        groups[0]!.rank,
        groups[1]!.rank,
        groups[2]!.rank,
      ],
    };
  }

  if (groups[0]!.count === 2) {
    return {
      category: "pair",
      tiebreakers: [groups[0]!.rank, ...groups.slice(1).map(({ rank }) => rank)],
    };
  }

  return { category: "high-card", tiebreakers: ranks };
}

function getFiveCardHands(cards: readonly Card[]): Card[][] {
  const hands: Card[][] = [];

  function choose(start: number, selected: Card[]): void {
    if (selected.length === 5) {
      hands.push(selected);
      return;
    }

    const remaining = 5 - selected.length;
    for (let i = start; i <= cards.length - remaining; i++) {
      choose(i + 1, [...selected, cards[i]!]);
    }
  }

  choose(0, []);
  return hands;
}

export function evaluateHand(cards: readonly Card[]): HandScore {
  if (cards.length < 5 || cards.length > 7) {
    throw new RangeError("A hand must contain between 5 and 7 cards");
  }

  const identities = cards.map(({ suit, rank }) => `${suit}-${rank}`);
  if (new Set(identities).size !== cards.length) {
    throw new TypeError("A hand cannot contain duplicate cards");
  }

  const fiveCardHands = getFiveCardHands(cards);
  let bestScore = scoreFiveCards(fiveCardHands[0]!);

  for (const hand of fiveCardHands.slice(1)) {
    const score = scoreFiveCards(hand);
    if (compare(score, bestScore) > 0) {
      bestScore = score;
    }
  }

  return bestScore;
}

export function compare(a: HandScore, b: HandScore): ComparisonResult {
  const categoryDifference =
    categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
  if (categoryDifference !== 0) {
    return categoryDifference > 0 ? 1 : -1;
  }

  const length = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < length; i++) {
    const difference = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }

  return 0;
}
