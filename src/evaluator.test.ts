import { describe, expect, test } from "bun:test";
import type { Card, Suit } from "./cards";
import type { HandCategory } from "./evaluator";
import { compare, evaluateHand } from "./evaluator";

function card(rank: Card["rank"], suit: Suit): Card {
  return { rank, suit };
}

describe("evaluateHand", () => {
  test("ranks every hand category", () => {
    const cases: Array<[Card[], HandCategory]> = [
      [[card(2, "clubs"), card(5, "diamonds"), card(7, "hearts"), card(9, "spades"), card(11, "clubs")], "high-card"],
      [[card(2, "clubs"), card(2, "diamonds"), card(5, "hearts"), card(7, "spades"), card(9, "clubs")], "pair"],
      [[card(2, "clubs"), card(2, "diamonds"), card(4, "hearts"), card(4, "spades"), card(9, "clubs")], "two-pair"],
      [[card(3, "clubs"), card(3, "diamonds"), card(3, "hearts"), card(7, "spades"), card(11, "clubs")], "three-of-a-kind"],
      [[card(5, "clubs"), card(6, "diamonds"), card(7, "hearts"), card(8, "spades"), card(9, "clubs")], "straight"],
      [[card(2, "hearts"), card(5, "hearts"), card(7, "hearts"), card(9, "hearts"), card(11, "hearts")], "flush"],
      [[card(2, "clubs"), card(2, "diamonds"), card(2, "hearts"), card(9, "clubs"), card(9, "diamonds")], "full-house"],
      [[card(3, "clubs"), card(3, "diamonds"), card(3, "hearts"), card(3, "spades"), card(9, "clubs")], "four-of-a-kind"],
      [[card(5, "hearts"), card(6, "hearts"), card(7, "hearts"), card(8, "hearts"), card(9, "hearts")], "straight-flush"],
    ];

    for (const [cards, category] of cases) {
      expect(evaluateHand(cards).category).toBe(category);
    }
  });

  test("treats a royal flush as a straight flush with ace high", () => {
    const score = evaluateHand([
      card(10, "spades"),
      card(11, "spades"),
      card(12, "spades"),
      card(13, "spades"),
      card(14, "spades"),
    ]);

    expect(score).toEqual({ category: "straight-flush", tiebreakers: [14] });
  });

  test("treats an ace-low wheel as a five-high straight", () => {
    const wheel = evaluateHand([
      card(14, "clubs"),
      card(2, "diamonds"),
      card(3, "hearts"),
      card(4, "spades"),
      card(5, "clubs"),
    ]);
    const sixHigh = evaluateHand([
      card(2, "clubs"),
      card(3, "diamonds"),
      card(4, "hearts"),
      card(5, "spades"),
      card(6, "clubs"),
    ]);

    expect(wheel.tiebreakers).toEqual([5]);
    expect(compare(wheel, sixHigh)).toBe(-1);
  });

  test("selects the strongest five cards from seven", () => {
    const score = evaluateHand([
      card(2, "hearts"),
      card(5, "hearts"),
      card(7, "hearts"),
      card(9, "hearts"),
      card(11, "hearts"),
      card(2, "clubs"),
      card(4, "diamonds"),
    ]);

    expect(score.category).toBe("flush");
  });

  test("rejects hands outside the five-to-seven-card range", () => {
    expect(() => evaluateHand([card(2, "clubs")])).toThrow(RangeError);
  });
});

describe("compare", () => {
  test("ranks a full house above a flush", () => {
    const fullHouse = evaluateHand([
      card(2, "clubs"),
      card(2, "diamonds"),
      card(2, "hearts"),
      card(9, "clubs"),
      card(9, "diamonds"),
    ]);
    const flush = evaluateHand([
      card(2, "hearts"),
      card(5, "hearts"),
      card(7, "hearts"),
      card(9, "hearts"),
      card(11, "hearts"),
    ]);

    expect(compare(fullHouse, flush)).toBe(1);
  });

  test("compares pair ranks and then kickers", () => {
    const kings = evaluateHand([
      card(13, "clubs"),
      card(13, "diamonds"),
      card(14, "hearts"),
      card(9, "spades"),
      card(7, "clubs"),
    ]);
    const nines = evaluateHand([
      card(9, "clubs"),
      card(9, "diamonds"),
      card(14, "spades"),
      card(12, "hearts"),
      card(7, "diamonds"),
    ]);
    const samePairWeakerKicker = evaluateHand([
      card(13, "hearts"),
      card(13, "spades"),
      card(14, "clubs"),
      card(8, "hearts"),
      card(7, "spades"),
    ]);

    expect(compare(kings, nines)).toBe(1);
    expect(compare(kings, samePairWeakerKicker)).toBe(1);
  });

  test("returns zero for hands with identical scores", () => {
    const first = evaluateHand([
      card(2, "clubs"),
      card(5, "diamonds"),
      card(7, "hearts"),
      card(9, "spades"),
      card(11, "clubs"),
    ]);
    const second = evaluateHand([
      card(2, "diamonds"),
      card(5, "hearts"),
      card(7, "spades"),
      card(9, "clubs"),
      card(11, "diamonds"),
    ]);

    expect(compare(first, second)).toBe(0);
  });
});
