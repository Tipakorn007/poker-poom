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

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
