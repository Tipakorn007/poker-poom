# poker-poom

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/server.ts
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

## Server

The Bun HTTP and WebSocket server listens on port `3000` by default, or on
`PORT` when set. WebSocket clients connect to `ws://localhost:3000/ws`; static
files are served from `public/`.
The first protocol messages are JSON, for example:

```json
{"type":"create_room","startingChips":750}
{"type":"join_room","roomCode":"ABCD"}
{"type":"reconnect","roomCode":"ABCD","token":"<secret from the room response>"}
{"type":"start_game"}
{"type":"action","action":{"type":"raise","amount":40}}
```

The server assigns player IDs from the connection and ignores player IDs sent by
clients. Keep the reconnect token secret. Disconnected players are folded after
60 seconds when their turn comes up; empty rooms expire after 30 minutes. The
server allows 100 rooms and 30 messages per connection per 10 seconds.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
