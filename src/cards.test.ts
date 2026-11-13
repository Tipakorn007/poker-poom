import { describe, expect, test } from "bun:test";
import { createDeck, shuffleDeck } from "./cards";

describe("createDeck", () => {
  test("creates 52 unique cards with every suit and rank", () => {
    const deck = createDeck();
    const identities = deck.map(({ suit, rank }) => `${suit}-${rank}`);

    expect(deck).toHaveLength(52);
    expect(new Set(identities).size).toBe(52);
    expect(new Set(deck.map(({ suit }) => suit)).size).toBe(4);
    expect(new Set(deck.map(({ rank }) => rank)).size).toBe(13);
  });
});

describe("shuffleDeck", () => {
  test("uses Fisher-Yates and leaves the input unchanged", () => {
    const cards = [1, 2, 3];
    const randomValues = [0, 0];

    const shuffled = shuffleDeck(cards, () => randomValues.shift()!);

    expect(shuffled).toEqual([2, 3, 1]);
    expect(cards).toEqual([1, 2, 3]);
  });

  test("preserves every card in the deck", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);

    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map(({ suit, rank }) => `${suit}-${rank}`)).size).toBe(52);
  });

  test("rejects values outside the random range", () => {
    expect(() => shuffleDeck([1, 2], () => 1)).toThrow(RangeError);
  });
});
