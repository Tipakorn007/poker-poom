import { describe, expect, test } from "bun:test";
import { RoomService } from "./rooms";
import type { Delivery, ServerMessage } from "./rooms";

const defaultOptions = {
  maxRooms: 100,
  maxMessagesPerWindow: 30,
  rateLimitWindowMs: 10_000,
  disconnectWaitMs: 60_000,
  emptyRoomTtlMs: 30 * 60_000,
  botDelayMs: 600,
};

function createService(
  now: () => number = () => 1_000,
  overrides: Partial<typeof defaultOptions> = {},
): RoomService {
  return new RoomService({ ...defaultOptions, ...overrides, now });
}

function send(service: RoomService, connectionId: string, value: unknown): Delivery[] {
  return service.handleMessage(connectionId, JSON.stringify(value));
}

function getMessage<T extends ServerMessage["type"]>(
  deliveries: readonly Delivery[],
  connectionId: string,
  type: T,
): Extract<ServerMessage, { type: T }> {
  const message = deliveries.find(
    (delivery) =>
      delivery.connectionId === connectionId && delivery.message.type === type,
  )?.message;
  if (!message || message.type !== type) {
    throw new Error(`Missing ${type} message for ${connectionId}`);
  }
  return message as Extract<ServerMessage, { type: T }>;
}

function createRoom(
  service: RoomService,
  connectionId: string,
  startingChips = 1_000,
): Extract<ServerMessage, { type: "room_created" }> {
  return getMessage(
    send(service, connectionId, { type: "create_room", startingChips }),
    connectionId,
    "room_created",
  );
}

function joinRoom(
  service: RoomService,
  connectionId: string,
  roomCode: string,
): Extract<ServerMessage, { type: "room_joined" }> {
  return getMessage(
    send(service, connectionId, { type: "join_room", roomCode }),
    connectionId,
    "room_joined",
  );
}

function startGame(service: RoomService, connectionId: string): void {
  send(service, connectionId, { type: "start_game" });
}

describe("room creation and joining", () => {
  test("creates a four-character room and lets players join", () => {
    const service = createService();
    const createdResponse = send(service, "socket-A", {
      type: "create_room",
      startingChips: 750,
      displayName: "  Alice   <b> ",
    });
    const created = getMessage(createdResponse, "socket-A", "room_created");
    const joinedResponse = send(service, "socket-B", {
      type: "join_room",
      roomCode: created.roomCode,
      displayName: "Bob",
    });
    const joined = getMessage(joinedResponse, "socket-B", "room_joined");
    const secondRoom = createRoom(service, "socket-C");

    expect(created.roomCode).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(secondRoom.roomCode).not.toBe(created.roomCode);
    expect(created.startingChips).toBe(750);
    expect(joined.roomCode).toBe(created.roomCode);
    expect(joined.playerId).not.toBe(created.playerId);
    const status = getMessage(joinedResponse, "socket-A", "room_status");
    expect(status.players.map(({ displayName }) => displayName)).toEqual([
      "Alice <b>",
      "Bob",
    ]);
    expect(
      getMessage(
        send(service, "socket-A", { type: "start_game" }),
        "socket-A",
        "state",
      ).state.players.every(({ chips }) => chips === 750),
    ).toBe(true);
  });

  test("includes hand categories only in revealed showdown state", () => {
    const service = createService();
    const created = createRoom(service, "socket-A");
    const joined = joinRoom(service, "socket-B", created.roomCode);
    startGame(service, "socket-A");

    let activePlayer = joined.playerId;
    let response: Delivery[] = [];
    for (let action = 0; action < 8; action++) {
      response = send(service, activePlayer === joined.playerId ? "socket-B" : "socket-A", {
        type: "action",
        action: { type: "check" },
      });
      activePlayer = activePlayer === joined.playerId ? created.playerId : joined.playerId;
    }

    const showdown = getMessage(response, "socket-A", "state");
    expect(showdown.state.stage).toBe("showdown");
    expect(showdown.handCategories?.[created.playerId]).toBeDefined();
    expect(showdown.handCategories?.[joined.playerId]).toBeDefined();
    expect(showdown.playerNames[created.playerId]).toBe("Player");
    expect(showdown.state.players.find(({ id }) => id === joined.playerId)?.holeCards).toHaveLength(2);
  });

  test("rejects a wrong room code and a room with more than ten players", () => {
    const service = createService();
    const badCode = send(service, "unknown", {
      type: "join_room",
      roomCode: "ZZZZ",
    });
    expect(getMessage(badCode, "unknown", "error").message).toBe("Room not found");

    const { roomCode } = createRoom(service, "socket-0");
    for (let index = 1; index < 10; index++) {
      joinRoom(service, `socket-${index}`, roomCode);
    }

    const full = send(service, "socket-overflow", {
      type: "join_room",
      roomCode,
    });
    expect(getMessage(full, "socket-overflow", "error").message).toBe("This room is full");
  });

  test("enforces the configured room limit", () => {
    const service = createService(() => 1_000, { maxRooms: 1 });
    createRoom(service, "socket-A");

    const response = send(service, "socket-B", {
      type: "create_room",
      startingChips: 1_000,
    });
    expect(getMessage(response, "socket-B", "error").message).toContain("room limit");
  });

  test("lets the owner start alone with a bot and waits before its turn", () => {
    let now = 1_000;
    const service = createService(() => now);
    const created = createRoom(service, "socket-A");
    const added = send(service, "socket-A", { type: "add_bot" });
    const roomStatus = getMessage(added, "socket-A", "room_status");
    const bot = roomStatus.players.find(({ isBot }) => isBot);

    expect(bot?.displayName).toBe("บอท 1");
    expect(bot?.connected).toBe(true);

    const started = send(service, "socket-A", { type: "start_game" });
    const initialState = getMessage(started, "socket-A", "state").state;
    expect(initialState.players).toHaveLength(2);
    expect(bot).toBeDefined();
    expect(initialState.turn).toBe(bot!.id);
    expect(service.runMaintenance(now + 599)).toHaveLength(0);

    now += 600;
    const botAction = service.runMaintenance(now);
    const updatedState = getMessage(botAction, "socket-A", "state").state;
    expect(updatedState.turn).toBe(created.playerId);
  });

  test("restricts adding bots to the owner and stops at ten seats", () => {
    const service = createService();
    const created = createRoom(service, "socket-A");
    joinRoom(service, "socket-B", created.roomCode);

    const denied = send(service, "socket-B", { type: "add_bot" });
    expect(getMessage(denied, "socket-B", "error").message).toContain("Only the room owner");

    let statusResponse: Delivery[] = [];
    for (let index = 0; index < 8; index++) {
      statusResponse = send(service, "socket-A", { type: "add_bot" });
    }
    const status = getMessage(statusResponse, "socket-A", "room_status");
    expect(status.players).toHaveLength(10);

    const full = send(service, "socket-A", { type: "add_bot" });
    expect(getMessage(full, "socket-A", "error").message).toBe("The room is full");
  });
});

describe("connection identity and reconnect tokens", () => {
  test("ignores a forged playerId and applies an action to the connection's seat", () => {
    const service = createService();
    const created = createRoom(service, "socket-A");
    joinRoom(service, "socket-B", created.roomCode);
    startGame(service, "socket-A");

    const response = send(service, "socket-B", {
      type: "action",
      playerId: created.playerId,
      action: { type: "check" },
    });
    const state = getMessage(response, "socket-B", "state").state;

    expect(state.playerId).not.toBe(created.playerId);
    expect(state.turn).toBe(created.playerId);
    expect(response.some(({ message }) => message.type === "error")).toBe(false);
  });

  test("reconnects with the right token and preserves the same hand and chips", () => {
    const service = createService();
    const created = createRoom(service, "socket-A", 500);
    const joined = joinRoom(service, "socket-B", created.roomCode);
    startGame(service, "socket-A");
    send(service, "socket-B", {
      type: "action",
      action: { type: "raise", amount: 40 },
    });
    service.disconnect("socket-B");

    const rejected = send(service, "socket-B2", {
      type: "reconnect",
      roomCode: created.roomCode,
      token: "wrong-token",
    });
    expect(getMessage(rejected, "socket-B2", "error").message).toBe(
      "Invalid reconnect token",
    );

    const reconnected = send(service, "socket-B2", {
      type: "reconnect",
      roomCode: created.roomCode,
      token: joined.token,
    });
    expect(getMessage(reconnected, "socket-B2", "room_reconnected").playerId).toBe(
      joined.playerId,
    );

    const state = getMessage(reconnected, "socket-B2", "state").state;
    expect(state.players.find(({ id }) => id === joined.playerId)?.chips).toBe(460);
    expect(state.players.find(({ id }) => id === joined.playerId)?.holeCards).toHaveLength(2);
    expect(state.currentBet).toBe(40);
    expect(state.turn).toBe(created.playerId);
  });
});

describe("safe player views and message validation", () => {
  test("sends a personalized view without other hands or the undealt deck", () => {
    const service = createService();
    const created = createRoom(service, "socket-A");
    joinRoom(service, "socket-B", created.roomCode);
    const deliveries = send(service, "socket-A", { type: "start_game" });

    for (const delivery of deliveries.filter(({ message }) => message.type === "state")) {
      if (delivery.message.type !== "state") {
        continue;
      }
      const { state } = delivery.message;
      expect(state.players.find(({ id }) => id === state.playerId)?.holeCards).toHaveLength(2);
      expect(
        state.players
          .filter(({ id }) => id !== state.playerId)
          .every(({ holeCards }) => holeCards === undefined),
      ).toBe(true);
      expect("deck" in state).toBe(false);
    }
    expect(deliveries.filter(({ message }) => message.type === "state")).toHaveLength(2);
  });

  test("returns errors for malformed and unknown messages without throwing", () => {
    const service = createService();

    expect(() => service.handleMessage("socket-A", "{")).not.toThrow();
    expect(getMessage(service.handleMessage("socket-A", "{"), "socket-A", "error").message)
      .toBe("Invalid JSON");
    expect(
      getMessage(
        send(service, "socket-A", { type: "unknown" }),
        "socket-A",
        "error",
      ).message,
    ).toBe("Unknown message type");
    expect(
      getMessage(
        send(service, "socket-A", { type: "create_room" }),
        "socket-A",
        "error",
      ).message,
    ).toContain("startingChips");
  });

  test("limits message frequency per connection", () => {
    let now = 1_000;
    const service = createService(() => now, { maxMessagesPerWindow: 2 });
    send(service, "socket-A", { type: "unknown" });
    send(service, "socket-A", { type: "unknown" });

    const limited = send(service, "socket-A", { type: "unknown" });
    expect(getMessage(limited, "socket-A", "error").message).toContain("Too many");

    now += 10_000;
    const reset = send(service, "socket-A", { type: "unknown" });
    expect(getMessage(reset, "socket-A", "error").message).toBe("Unknown message type");
  });
});

describe("disconnect and room cleanup policies", () => {
  test("folds a disconnected player after the grace period", () => {
    let now = 1_000;
    const service = createService(() => now);
    const created = createRoom(service, "socket-A");
    joinRoom(service, "socket-B", created.roomCode);
    startGame(service, "socket-A");
    service.disconnect("socket-B");

    now += 59_999;
    expect(service.runMaintenance()).toHaveLength(0);

    now++;
    const updates = service.runMaintenance();
    const state = getMessage(updates, "socket-A", "state").state;
    expect(state.stage).toBe("showdown");
    expect(state.winners).toHaveLength(1);
    expect(state.players.find(({ id }) => id !== created.playerId)?.folded).toBe(true);
  });

  test("removes a room after it has been empty for 30 minutes", () => {
    let now = 1_000;
    const service = createService(() => now);
    const created = createRoom(service, "socket-A");
    service.disconnect("socket-A");

    now += 30 * 60_000 - 1;
    service.runMaintenance();
    const beforeExpiry = send(service, "socket-B", {
      type: "reconnect",
      roomCode: created.roomCode,
      token: "wrong",
    });
    expect(getMessage(beforeExpiry, "socket-B", "error").message).toBe(
      "Invalid reconnect token",
    );

    now++;
    service.runMaintenance();
    const afterExpiry = send(service, "socket-C", {
      type: "join_room",
      roomCode: created.roomCode,
    });
    expect(getMessage(afterExpiry, "socket-C", "error").message).toBe("Room not found");
  });
});
