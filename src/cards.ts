export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type Card = Readonly<{
  suit: Suit;
  rank: Rank;
}>;

const suits: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const ranks: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function createDeck(): Card[] {
  return suits.flatMap((suit) =>
    ranks.map((rank) => ({ suit, rank })),
  );
}

export function shuffleDeck<T>(
  cards: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = [...cards];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("Random source must return a number from 0 to less than 1");
    }

    const j = Math.floor(value * (i + 1));
    const current = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = current;
  }

  return shuffled;
}
