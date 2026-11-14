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

Build the lightweight browser bundle, then start the server:

```bash
bun run build:client
bun run src/server.ts
```

Open `http://localhost:3000` on a computer or phone. The Bun HTTP and WebSocket
server listens on port `3000` by default, or on `PORT` when set. WebSocket
clients connect to `/ws`; static files are served from `public/`.
The first protocol messages are JSON, for example:

```json
{"type":"create_room","displayName":"Poom","startingChips":750}
{"type":"join_room","displayName":"Friend","roomCode":"ABCD"}
{"type":"add_bot"}
{"type":"reconnect","roomCode":"ABCD","token":"<secret from the room response>"}
{"type":"start_game"}
{"type":"action","action":{"type":"raise","amount":40}}
```

The server assigns player IDs from the connection and ignores player IDs sent by
clients. Keep the reconnect token secret. Disconnected players are folded after
60 seconds when their turn comes up; empty rooms expire after 30 minutes. The
server allows 100 rooms and 30 messages per connection per 10 seconds.

The room owner can add bots before starting; human players and bots together
can fill up to 10 seats. One human can start with one or more bots. Bots play
simple, cautious poker decisions on the server and wait 600 ms before acting.

## Browser UI

The mobile-first interface uses plain TypeScript, CSS, and the browser's native
WebSocket and Web Audio APIs. `src/client.ts` renders the server view and sends
player actions; `src/ui-model.ts` contains small formatting and button-state
helpers. Build with Bun using `bun run build:client`. No frontend framework or
external assets are loaded.

Names and reconnect credentials are kept in local storage on the player's
device. The reconnect token should be treated as a secret. The sound toggle is
on by default; sounds begin after the first user interaction and can be turned
off at any time.

### Manual UI checklist

- Open the home page on a narrow phone viewport and a desktop viewport; check
  the name, room creation, room code entry, and safe-area spacing.
- Open two browser sessions, create a room in one, join from the other, and
  verify the owner-only start button and both player names.
- In a room with one human, add a bot and start; verify the bot shows a
  thinking indicator, waits briefly, and then acts automatically.
- Start the hand; verify the active player highlight, private cards, face-down
  opponent cards, board cards, pot, and action buttons update only after server
  messages.
- Play check/call/raise/fold through showdown; check winners and hand categories
  come from server messages, and folded hands remain hidden.
- Refresh a session while seated; verify it reconnects to the same seat and
  cards. Temporarily stop the server and verify the reconnect status/backoff.
- Toggle sound, enable reduced motion, and hide/show the tab; confirm there is
  no external audio/font/image request or animation while hidden.
- Enter a name containing markup such as `<img src=x onerror=alert(1)>`; verify
  it appears as text and does not execute.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
