import { createGame, applyAction, getPlayerView } from "./game";
import type { GameState, PlayerAction, PlayerView } from "./game";
import { evaluateHand } from "./evaluator";
import { chooseBotAction } from "./bot";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_PLAYERS = 10;
const MAX_STARTING_CHIPS = Math.floor(Number.MAX_SAFE_INTEGER / MAX_PLAYERS);
const MAX_MESSAGE_LENGTH = 16_384;

type ConnectionPlayer = {
  roomCode: string;
  playerId: string;
};

type RoomPlayer = {
  id: string;
  displayName: string;
  isBot: boolean;
  token: string;
  connectionId: string | null;
  disconnectedAt: number | null;
};

type Room = {
  code: string;
  ownerId: string;
  startingChips: number;
  players: RoomPlayer[];
  game: GameState | null;
  botActionAt: number | null;
  emptySince: number | null;
};

export type RoomServiceOptions = Readonly<{
  maxRooms: number;
  maxMessagesPerWindow: number;
  rateLimitWindowMs: number;
  disconnectWaitMs: number;
  emptyRoomTtlMs: number;
  botDelayMs: number;
  now?: () => number;
}>;

export type ServerMessage =
  | Readonly<{
      type: "room_created";
      roomCode: string;
      playerId: string;
      token: string;
      startingChips: number;
    }>
  | Readonly<{
      type: "room_joined";
      roomCode: string;
      playerId: string;
      token: string;
      startingChips: number;
    }>
  | Readonly<{
      type: "room_reconnected";
      roomCode: string;
      playerId: string;
    }>
  | Readonly<{
      type: "room_status";
      roomCode: string;
      ownerId: string;
      startingChips: number;
      maxPlayers: number;
      players: readonly Readonly<{
        id: string;
        displayName: string;
        isBot: boolean;
        connected: boolean;
      }>[];
    }>
  | Readonly<{
      type: "state";
      roomCode: string;
      state: PlayerView;
      playerNames: Readonly<Record<string, string>>;
      botPlayerIds: readonly string[];
      handCategories?: Readonly<Record<string, string>>;
    }>
  | Readonly<{ type: "error"; message: string }>;

export type Delivery = Readonly<{
  connectionId: string;
  message: ServerMessage;
}>;

type IncomingMessage =
  | Readonly<{ type: "create_room"; startingChips: number; displayName: string }>
  | Readonly<{ type: "join_room"; roomCode: string; displayName: string }>
  | Readonly<{ type: "reconnect"; roomCode: string; token: string }>
  | Readonly<{ type: "start_game" }>
  | Readonly<{ type: "add_bot" }>
  | Readonly<{ type: "action"; action: PlayerAction }>;

class RoomError extends Error {}

function parseDisplayName(value: unknown): string {
  if (value === undefined) {
    return "Player";
  }
  if (typeof value !== "string") {
    throw new RoomError("displayName must be text");
  }
  const displayName = value.trim().replace(/\s+/g, " ");
  if (displayName.length < 1 || displayName.length > 24) {
    throw new RoomError("displayName must be 1 to 24 characters");
  }
  return displayName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIncomingMessage(raw: unknown): IncomingMessage {
  if (typeof raw !== "string") {
    throw new RoomError("Messages must be JSON text");
  }
  if (raw.length > MAX_MESSAGE_LENGTH) {
    throw new RoomError("Message is too large");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RoomError("Invalid JSON");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new RoomError("Message must be an object with a type");
  }

  switch (value.type) {
    case "create_room":
      if (
        !Number.isSafeInteger(value.startingChips) ||
        Number(value.startingChips) < 1 ||
        Number(value.startingChips) > MAX_STARTING_CHIPS
      ) {
        throw new RoomError(
          `startingChips must be between 1 and ${MAX_STARTING_CHIPS}`,
        );
      }
      return {
        type: "create_room",
        startingChips: Number(value.startingChips),
        displayName: parseDisplayName(value.displayName),
      };

    case "join_room":
      if (typeof value.roomCode !== "string") {
        throw new RoomError("roomCode is required");
      }
      return {
        type: "join_room",
        roomCode: value.roomCode,
        displayName: parseDisplayName(value.displayName),
      };

    case "reconnect":
      if (typeof value.roomCode !== "string" || typeof value.token !== "string") {
        throw new RoomError("roomCode and token are required");
      }
      return { type: "reconnect", roomCode: value.roomCode, token: value.token };

    case "start_game":
      return { type: "start_game" };

    case "add_bot":
      return { type: "add_bot" };

    case "action": {
      if (!isRecord(value.action) || typeof value.action.type !== "string") {
        throw new RoomError("action is required");
      }
      switch (value.action.type) {
        case "fold":
        case "check":
        case "call":
          return { type: "action", action: { type: value.action.type } };
        case "raise":
          if (!Number.isSafeInteger(value.action.amount)) {
            throw new RoomError("raise amount must be an integer");
          }
          return {
            type: "action",
            action: { type: "raise", amount: Number(value.action.amount) },
          };
        default:
          throw new RoomError("Unknown action type");
      }
    }

    default:
      throw new RoomError("Unknown message type");
  }
}

function randomRoomCode(): string {
  let code = "";
  while (code.length < 4) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    for (const byte of bytes) {
      if (byte >= 240) {
        continue;
      }
      code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      if (code.length === 4) {
        break;
      }
    }
  }
  return code;
}

function randomSecret(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function normalizeRoomCode(roomCode: string): string {
  const normalized = roomCode.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z]{4}$/.test(normalized)) {
    throw new RoomError("Invalid room code");
  }
  return normalized;
}

export class RoomService {
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Map<string, ConnectionPlayer>();
  private readonly rateWindows = new Map<string, { startedAt: number; count: number }>();
  private readonly now: () => number;

  constructor(private readonly options: RoomServiceOptions) {
    for (const [name, value] of [
      ["maxRooms", options.maxRooms],
      ["maxMessagesPerWindow", options.maxMessagesPerWindow],
      ["rateLimitWindowMs", options.rateLimitWindowMs],
      ["emptyRoomTtlMs", options.emptyRoomTtlMs],
      ["botDelayMs", options.botDelayMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
    if (!Number.isSafeInteger(options.disconnectWaitMs) || options.disconnectWaitMs < 0) {
      throw new RangeError("disconnectWaitMs must be a non-negative safe integer");
    }
    this.now = options.now ?? Date.now;
  }

  handleMessage(connectionId: string, raw: unknown): Delivery[] {
    const now = this.now();
    const deliveries = this.runMaintenance(now);

    if (this.isRateLimited(connectionId, now)) {
      return [...deliveries, this.error(connectionId, "Too many messages; try again later")];
    }

    let message: IncomingMessage;
    try {
      message = parseIncomingMessage(raw);
    } catch (error) {
      if (error instanceof RoomError) {
        return [...deliveries, this.error(connectionId, error.message)];
      }
      throw error;
    }

    try {
      return [...deliveries, ...this.dispatch(connectionId, message, now)];
    } catch (error) {
      if (error instanceof RoomError) {
        return [...deliveries, this.error(connectionId, error.message)];
      }
      throw error;
    }
  }

  disconnect(connectionId: string): Delivery[] {
    const identity = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    this.rateWindows.delete(connectionId);
    if (!identity) {
      return [];
    }

    const room = this.rooms.get(identity.roomCode);
    const player = room?.players.find(({ id }) => id === identity.playerId);
    if (!room || !player || player.connectionId !== connectionId) {
      return [];
    }

    player.connectionId = null;
    player.disconnectedAt = this.now();
    if (room.players.every(({ connectionId: id }) => id === null)) {
      room.emptySince = this.now();
    }

    return this.broadcastRoom(room);
  }

  runMaintenance(now = this.now()): Delivery[] {
    const deliveries: Delivery[] = [];

    for (const room of this.rooms.values()) {
      if (
        room.emptySince !== null &&
        now - room.emptySince >= this.options.emptyRoomTtlMs
      ) {
        this.deleteRoom(room);
        continue;
      }

      if (room.game) {
        deliveries.push(...this.processAutomatedTurns(room, now));
      }
    }

    return deliveries;
  }

  private dispatch(
    connectionId: string,
    message: IncomingMessage,
    now: number,
  ): Delivery[] {
    if (message.type === "create_room") {
      this.requireUnbound(connectionId);
      return this.createRoom(connectionId, message.startingChips, message.displayName);
    }
    if (message.type === "join_room") {
      this.requireUnbound(connectionId);
      return this.joinRoom(connectionId, message.roomCode, message.displayName);
    }
    if (message.type === "reconnect") {
      this.requireUnbound(connectionId);
      return this.reconnect(connectionId, message.roomCode, message.token);
    }

    const identity = this.connections.get(connectionId);
    if (!identity) {
      throw new RoomError("Join or create a room first");
    }
    const room = this.rooms.get(identity.roomCode);
    const player = room?.players.find(({ id }) => id === identity.playerId);
    if (!room || !player || player.connectionId !== connectionId) {
      throw new RoomError("This connection is no longer in the room");
    }

    if (message.type === "add_bot") {
      if (identity.playerId !== room.ownerId) {
        throw new RoomError("Only the room owner can add bots");
      }
      if (room.game) {
        throw new RoomError("Bots can only be added before the game starts");
      }
      if (room.players.length >= MAX_PLAYERS) {
        throw new RoomError("The room is full");
      }
      const botCount = room.players.filter(({ isBot }) => isBot).length + 1;
      room.players.push(this.newBot(`บอท ${botCount}`));
      return this.broadcastRoom(room);
    }

    if (message.type === "start_game") {
      if (identity.playerId !== room.ownerId) {
        throw new RoomError("Only the room owner can start the game");
      }
      if (room.game) {
        throw new RoomError("The game has already started");
      }
      if (room.players.filter(({ isBot, connectionId: id }) => isBot || id !== null).length < 2) {
        throw new RoomError("At least two connected players or bots are required");
      }

      const baseGame = createGame(room.players.map(({ id }) => id));
      room.game = {
        ...baseGame,
        players: baseGame.players.map((gamePlayer) => ({
          ...gamePlayer,
          chips: room.startingChips,
        })),
      };
      this.scheduleAutomaticTurn(room, now);
      return [
        ...this.broadcastGame(room),
        ...this.processAutomatedTurns(room, now),
      ];
    }

    if (!room.game) {
      throw new RoomError("The game has not started");
    }

    try {
      room.game = applyAction(room.game, identity.playerId, message.action);
    } catch (error) {
      if (error instanceof Error) {
        throw new RoomError(error.message);
      }
      throw error;
    }

    this.scheduleAutomaticTurn(room, now);
    return [
      ...this.broadcastGame(room),
      ...this.processAutomatedTurns(room, now),
    ];
  }

  private createRoom(
    connectionId: string,
    startingChips: number,
    displayName: string,
  ): Delivery[] {
    if (this.rooms.size >= this.options.maxRooms) {
      throw new RoomError("The server has reached its room limit");
    }

    let code: string | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = randomRoomCode();
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new RoomError("Could not allocate a room code; try again");
    }

    const player = this.newPlayer(connectionId, displayName);
    const room: Room = {
      code,
      ownerId: player.id,
      startingChips,
      players: [player],
      game: null,
      botActionAt: null,
      emptySince: null,
    };
    this.rooms.set(code, room);
    this.connections.set(connectionId, { roomCode: code, playerId: player.id });

    return [
      {
        connectionId,
        message: {
          type: "room_created",
          roomCode: code,
          playerId: player.id,
          token: player.token,
          startingChips,
        },
      },
      ...this.broadcastRoom(room),
    ];
  }

  private joinRoom(
    connectionId: string,
    requestedCode: string,
    displayName: string,
  ): Delivery[] {
    const room = this.requireRoom(requestedCode);
    if (room.game) {
      throw new RoomError("This game has already started");
    }
    if (room.players.length >= MAX_PLAYERS) {
      throw new RoomError("This room is full");
    }

    const player = this.newPlayer(connectionId, displayName);
    room.players.push(player);
    room.emptySince = null;
    this.connections.set(connectionId, { roomCode: room.code, playerId: player.id });

    return [
      {
        connectionId,
        message: {
          type: "room_joined",
          roomCode: room.code,
          playerId: player.id,
          token: player.token,
          startingChips: room.startingChips,
        },
      },
      ...this.broadcastRoom(room),
    ];
  }

  private reconnect(
    connectionId: string,
    requestedCode: string,
    token: string,
  ): Delivery[] {
    const room = this.requireRoom(requestedCode);
    const player = room.players.find((candidate) => candidate.token === token);
    if (!player) {
      throw new RoomError("Invalid reconnect token");
    }

    if (player.connectionId !== null && player.connectionId !== connectionId) {
      this.connections.delete(player.connectionId);
      this.rateWindows.delete(player.connectionId);
    }
    player.connectionId = connectionId;
    player.disconnectedAt = null;
    room.emptySince = null;
    this.connections.set(connectionId, { roomCode: room.code, playerId: player.id });

    return [
      {
        connectionId,
        message: {
          type: "room_reconnected",
          roomCode: room.code,
          playerId: player.id,
        },
      },
      ...this.broadcastRoom(room),
    ];
  }

  private newPlayer(connectionId: string, displayName: string): RoomPlayer {
    const player: RoomPlayer = {
      id: randomSecret(),
      displayName,
      isBot: false,
      token: randomSecret(),
      connectionId,
      disconnectedAt: null,
    };
    return player;
  }

  private newBot(displayName: string): RoomPlayer {
    return {
      id: randomSecret(),
      displayName,
      isBot: true,
      token: randomSecret(),
      connectionId: null,
      disconnectedAt: null,
    };
  }

  private requireRoom(requestedCode: string): Room {
    const code = normalizeRoomCode(requestedCode);
    const room = this.rooms.get(code);
    if (!room) {
      throw new RoomError("Room not found");
    }
    return room;
  }

  private requireUnbound(connectionId: string): void {
    if (this.connections.has(connectionId)) {
      throw new RoomError("This connection already has a seat");
    }
  }

  private broadcastRoom(room: Room): Delivery[] {
    if (room.game) {
      return this.broadcastGame(room);
    }

    const message: ServerMessage = {
      type: "room_status",
      roomCode: room.code,
      ownerId: room.ownerId,
      startingChips: room.startingChips,
      maxPlayers: MAX_PLAYERS,
      players: room.players.map(({ id, displayName, isBot, connectionId }) => ({
        id,
        displayName,
        isBot,
        connected: isBot || connectionId !== null,
      })),
    };

    return room.players.flatMap((player) =>
      player.connectionId === null
        ? []
        : [{ connectionId: player.connectionId, message }],
    );
  }

  private broadcastGame(room: Room): Delivery[] {
    if (!room.game) {
      return [];
    }

    const game = room.game;
    const playerNames = Object.fromEntries(
      room.players.map(({ id, displayName }) => [id, displayName]),
    );
    const botPlayerIds = room.players
      .filter(({ isBot }) => isBot)
      .map(({ id }) => id);
    const handCategories = game.showdownRevealed
      ? Object.fromEntries(
          game.players
            .filter((player) => !player.folded)
            .map((player) => [
              player.id,
              evaluateHand([...player.holeCards, ...game.board]).category,
            ]),
        )
      : undefined;
    return room.players.flatMap((player) =>
      player.connectionId === null
        ? []
        : [{
            connectionId: player.connectionId,
            message: {
              type: "state" as const,
              roomCode: room.code,
              state: getPlayerView(game, player.id),
              playerNames,
              botPlayerIds,
              ...(handCategories ? { handCategories } : {}),
            },
          }],
    );
  }

  private scheduleAutomaticTurn(room: Room, now: number): void {
    const currentPlayer = room.players.find(({ id }) => id === room.game?.turn);
    room.botActionAt =
      currentPlayer?.isBot && room.game
        ? now + this.options.botDelayMs
        : null;
  }

  private processAutomatedTurns(room: Room, now: number): Delivery[] {
    const deliveries: Delivery[] = [];

    while (room.game && room.game.turn !== null) {
      const currentPlayer = room.players.find(({ id }) => id === room.game?.turn);
      if (!currentPlayer) {
        break;
      }

      if (currentPlayer.isBot) {
        if (room.botActionAt === null || now < room.botActionAt) {
          break;
        }
        room.game = applyAction(
          room.game,
          currentPlayer.id,
          chooseBotAction(room.game, currentPlayer.id),
        );
        this.scheduleAutomaticTurn(room, now);
        deliveries.push(...this.broadcastGame(room));
        continue;
      }

      if (
        currentPlayer.connectionId !== null ||
        currentPlayer.disconnectedAt === null ||
        now - currentPlayer.disconnectedAt < this.options.disconnectWaitMs
      ) {
        room.botActionAt = null;
        break;
      }

      room.game = applyAction(room.game, currentPlayer.id, { type: "fold" });
      this.scheduleAutomaticTurn(room, now);
      deliveries.push(...this.broadcastGame(room));
    }

    return deliveries;
  }

  private deleteRoom(room: Room): void {
    this.rooms.delete(room.code);
    for (const player of room.players) {
      if (player.connectionId !== null) {
        this.connections.delete(player.connectionId);
        this.rateWindows.delete(player.connectionId);
      }
    }
  }

  private isRateLimited(connectionId: string, now: number): boolean {
    const window = this.rateWindows.get(connectionId);
    if (!window || now - window.startedAt >= this.options.rateLimitWindowMs) {
      this.rateWindows.set(connectionId, { startedAt: now, count: 1 });
      return false;
    }
    if (window.count >= this.options.maxMessagesPerWindow) {
      return true;
    }
    window.count++;
    return false;
  }

  private error(connectionId: string, message: string): Delivery {
    return { connectionId, message: { type: "error", message } };
  }
}
