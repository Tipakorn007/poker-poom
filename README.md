# poker-poom

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To run the tests:

```bash
bun test
```

## Cards

`src/cards.ts` exports `createDeck()` to create a standard 52-card deck and
`shuffleDeck(cards)` to return a shuffled copy using the Fisher-Yates algorithm.
The original array is left unchanged.

## Hand evaluation

`src/evaluator.ts` exports `evaluateHand(cards)` for five to seven cards. Its
score contains a hand category and ordered tie-breaker ranks. `compare(a, b)`
returns `1` when `a` wins, `-1` when `b` wins, and `0` for a tie.

## Game logic

`src/game.ts` exports `createGame`, `applyAction`, and `getPlayerView`. It handles
betting rounds and showdown without networking. The first version uses 1,000
starting chips, no blinds, and a 20-chip minimum raise. A raise amount is the
player's total contribution for the current round; all-ins are not allowed.
Tied pots are split evenly, with any odd chip going to the first tied player
left of the dealer button. Player views omit the undealt deck and other players'
private cards.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
