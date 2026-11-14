import type { Card } from "./cards";
import type { PlayerView } from "./game";
import type { ServerMessage } from "./rooms";
import {
  formatChips,
  getActionAvailability,
  getHandCategoryLabel,
  getReconnectDelay,
  getStageLabel,
} from "./ui-model";

type Credentials = {
  roomCode: string;
  playerId: string;
  token: string;
  displayName: string;
};

type RoomStatusMessage = Extract<ServerMessage, { type: "room_status" }>;
type StateMessage = Extract<ServerMessage, { type: "state" }>;
type SeatElements = {
  root: HTMLDivElement;
  name: HTMLDivElement;
  chips: HTMLSpanElement;
  status: HTMLSpanElement;
  cards: HTMLDivElement;
};

const storageKey = "poker-poom:seat";
const nameKey = "poker-poom:name";
const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing page element: ${selector}`);
  }
  return element;
};

const homeScreen = $("#home-screen");
const waitingScreen = $("#waiting-screen");
const gameScreen = $("#game-screen");
const homeError = $("#home-error");
const serverError = $("#server-error");
const playerNameInput = $("#player-name") as HTMLInputElement;
const startingChipsInput = $("#starting-chips") as HTMLInputElement;
const roomCodeInput = $("#room-code") as HTMLInputElement;
const connectionStatus = $("#connection-status");
const connectionLabel = $("#connection-label");
const waitingCode = $("#waiting-room-code");
const playerCount = $("#player-count");
const waitingList = $("#waiting-player-list");
const addBotButton = $("#add-bot") as HTMLButtonElement;
const startButton = $("#start-game") as HTMLButtonElement;
const startHint = $("#start-hint");
const gameRoomCode = $("#game-room-code");
const gameStage = $("#game-stage");
const turnIndicator = $("#turn-indicator");
const seatRing = $("#seat-ring");
const communityCards = $("#community-cards");
const boardHint = $("#board-hint");
const potValue = $("#pot-value");
const myCards = $("#my-cards");
const myChipCount = $("#my-chip-count");
const actionHint = $("#action-hint");
const foldButton = $("#fold-action") as HTMLButtonElement;
const checkButton = $("#check-action") as HTMLButtonElement;
const callButton = $("#call-action") as HTMLButtonElement;
const raiseButton = $("#raise-action") as HTMLButtonElement;
const raiseRange = $("#raise-amount") as HTMLInputElement;
const raiseNumber = $("#raise-number") as HTMLInputElement;
const raiseOutput = $("#raise-output");
const showdownPanel = $("#showdown-panel");
const winnerMessage = $("#winner-message");
const handResult = $("#hand-result");
const soundToggle = $("#sound-toggle") as HTMLButtonElement;

let socket: WebSocket | undefined;
let reconnectAttempt = 0;
let reconnectTimer: number | undefined;
let credentials = readCredentials();
let latestStateMessage: StateMessage | undefined;
let lastRoomFingerprint = "";
let lastStateFingerprint = "";
let lastRenderedTurn: string | null = null;
let audioContext: AudioContext | undefined;
let soundEnabled = true;
const seats = new Map<string, SeatElements>();
const waitingPlayers = new Map<string, HTMLLIElement>();
const faceRanks: Partial<Record<Card["rank"], string>> = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

function readCredentials(): Credentials | undefined {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "roomCode" in parsed &&
      typeof parsed.roomCode === "string" &&
      "playerId" in parsed &&
      typeof parsed.playerId === "string" &&
      "token" in parsed &&
      typeof parsed.token === "string" &&
      "displayName" in parsed &&
      typeof parsed.displayName === "string"
    ) {
      return parsed as Credentials;
    }
  } catch {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      showError("อ่านหรือจัดการข้อมูลเชื่อมต่อบนอุปกรณ์ไม่ได้");
    }
  }
  return undefined;
}

function saveCredentials(value: Credentials): void {
  credentials = value;
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    showError("บันทึกข้อมูลเชื่อมต่อบนอุปกรณ์ไม่ได้ หากปิดหน้านี้อาจต้องเข้าห้องใหม่");
  }
}

function removeCredentials(): void {
  credentials = undefined;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    showError("ล้างข้อมูลเชื่อมต่อที่บันทึกไว้ไม่ได้");
  }
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function setHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) {
    element.hidden = hidden;
  }
}

function setDisabled(element: HTMLButtonElement | HTMLInputElement, disabled: boolean): void {
  if (element.disabled !== disabled) {
    element.disabled = disabled;
  }
}

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function showHomeError(message: string): void {
  setText(homeError, message);
  setHidden(homeError, false);
}

function showError(message: string): void {
  serverError.dataset.success = "false";
  setText(serverError, message);
  setHidden(serverError, false);
}

function showNotice(message: string): void {
  serverError.dataset.success = "true";
  setText(serverError, message);
  setHidden(serverError, false);
}

function clearError(): void {
  setHidden(serverError, true);
  setHidden(homeError, true);
}

function friendlyError(message: string): string {
  const known: Readonly<Record<string, string>> = {
    "Invalid JSON": "ข้อความจากหน้าเว็บอ่านไม่ออก ลองอีกครั้ง",
    "Unknown message type": "เซิร์ฟเวอร์ไม่รู้จักคำสั่งนี้",
    "Invalid room code": "รหัสห้องต้องเป็นตัวอักษร 4 ตัว",
    "Room not found": "ไม่พบห้องนี้ ตรวจสอบรหัสแล้วลองใหม่",
    "This room is full": "ห้องนี้เต็มแล้ว",
    "The game has already started": "เกมเริ่มไปแล้ว เข้าห้องนี้ไม่ได้",
    "At least two connected players or bots are required": "ต้องมีผู้เล่นออนไลน์หรือบอทอย่างน้อย 2 คน",
    "Only the room owner can start the game": "มีเพียงเจ้าของห้องเท่านั้นที่เริ่มเกมได้",
    "Only the room owner can add bots": "มีเพียงเจ้าของห้องเท่านั้นที่เพิ่มบอทได้",
    "Bots can only be added before the game starts": "เพิ่มบอทได้ก่อนเริ่มเกมเท่านั้น",
    "The room is full": "ที่นั่งเต็มแล้ว (สูงสุด 10 คน)",
    "Invalid reconnect token": "โทเค็นต่อกลับใช้ไม่ได้ ข้อมูลที่นั่งเดิมถูกล้างแล้ว",
    "The server has reached its room limit": "เซิร์ฟเวอร์มีห้องเต็มชั่วคราว ลองใหม่ภายหลัง",
  };
  if (known[message]) {
    return known[message];
  }
  if (message.includes("not this player's turn")) {
    return "ยังไม่ถึงตาของคุณ";
  }
  if (message.includes("Cannot check")) {
    return "มีเดิมพันอยู่ ต้องคอลหรือหมอบ";
  }
  if (message.includes("at least")) {
    return "จำนวนเรสต่ำกว่าขั้นต่ำ";
  }
  if (message.includes("all of a player's remaining chips")) {
    return "จำนวนชิปไม่พอสำหรับคำสั่งนี้";
  }
  return message;
}

function setConnectionStatus(state: "connected" | "connecting" | "error", label: string): void {
  connectionStatus.dataset.state = state;
  setText(connectionLabel, label);
}

function send(value: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showError("ยังไม่ได้เชื่อมต่อ รอสักครู่แล้วลองอีกครั้ง");
    return false;
  }
  socket.send(JSON.stringify(value));
  return true;
}

function connect(): void {
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  setConnectionStatus("connecting", credentials ? "กำลังต่อกลับ…" : "กำลังเชื่อมต่อ…");
  socket = new WebSocket(`${scheme}//${window.location.host}/ws`);

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    setConnectionStatus("connected", "เชื่อมต่อแล้ว");
    clearError();
    if (credentials) {
      send({
        type: "reconnect",
        roomCode: credentials.roomCode,
        token: credentials.token,
      });
    }
  });

  socket.addEventListener("message", (event) => {
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      showError("ได้รับข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง");
      return;
    }
    if (!isServerMessage(message)) {
      showError("ได้รับข้อมูลจากเซิร์ฟเวอร์ไม่ครบถ้วน");
      return;
    }
    handleServerMessage(message);
  });

  socket.addEventListener("close", () => {
    setConnectionStatus("connecting", "การเชื่อมต่อขาด กำลังลองต่อใหม่…");
    const delay = getReconnectDelay(reconnectAttempt);
    reconnectAttempt++;
    reconnectTimer = window.setTimeout(connect, delay);
  });

  socket.addEventListener("error", () => {
    setConnectionStatus("error", "เชื่อมต่อไม่สำเร็จ");
  });
}

function isServerMessage(value: unknown): value is ServerMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function handleServerMessage(message: ServerMessage): void {
  if (message.type === "error") {
    const text = friendlyError(message.message);
    showError(text);
    if (
      credentials &&
      (message.message === "Invalid reconnect token" || message.message === "Room not found")
    ) {
      removeCredentials();
      showHome();
      showHomeError(text);
    }
    return;
  }

  clearError();
  switch (message.type) {
    case "room_created":
    case "room_joined":
      saveCredentials({
        roomCode: message.roomCode,
        playerId: message.playerId,
        token: message.token,
        displayName: playerNameInput.value.trim(),
      });
      setText(waitingCode, message.roomCode);
      showWaiting();
      break;

    case "room_reconnected":
      if (credentials) {
        saveCredentials({ ...credentials, roomCode: message.roomCode });
      }
      break;

    case "room_status":
      renderRoomStatus(message);
      showWaiting();
      break;

    case "state":
      latestStateMessage = message;
      renderGame(message);
      showGame();
      break;
  }
}

function showHome(): void {
  setHidden(homeScreen, false);
  setHidden(waitingScreen, true);
  setHidden(gameScreen, true);
}

function showWaiting(): void {
  setHidden(homeScreen, true);
  setHidden(waitingScreen, false);
  setHidden(gameScreen, true);
}

function showGame(): void {
  setHidden(homeScreen, true);
  setHidden(waitingScreen, true);
  setHidden(gameScreen, false);
}

function renderRoomStatus(message: RoomStatusMessage): void {
  const fingerprint = JSON.stringify(message);
  if (fingerprint === lastRoomFingerprint) {
    return;
  }
  lastRoomFingerprint = fingerprint;
  setText(waitingCode, message.roomCode);
  setText(playerCount, `${message.players.length}/${message.maxPlayers}`);
  const isOwner = message.ownerId === credentials?.playerId;
  const canStart = isOwner && message.players.length >= 2 && message.players.every(({ connected }) => connected);
  setHidden(startButton, !isOwner);
  setDisabled(startButton, !canStart);
  setHidden(addBotButton, !isOwner);
  setDisabled(addBotButton, message.players.length >= message.maxPlayers);
  setText(startHint, isOwner
    ? canStart
      ? "พร้อมแล้ว จะรอเพื่อนหรือเริ่มกับบอทก็ได้"
      : "เชิญเพื่อนหรือเพิ่มบอทให้ครบอย่างน้อย 2 ที่นั่ง"
    : "รอเจ้าของห้องเริ่มเกม");

  const incomingIds = new Set(message.players.map(({ id }) => id));
  for (const [id, item] of waitingPlayers) {
    if (!incomingIds.has(id)) {
      item.remove();
      waitingPlayers.delete(id);
    }
  }
  for (const player of message.players) {
    let item = waitingPlayers.get(player.id);
    if (!item) {
      item = document.createElement("li");
      item.className = "waiting-player";
      const name = document.createElement("span");
      name.className = "waiting-player-name";
      const badge = document.createElement("span");
      badge.className = "waiting-player-badge";
      const status = document.createElement("span");
      status.className = "player-connection";
      item.append(name, badge, status);
      waitingPlayers.set(player.id, item);
    }
    const name = item.querySelector<HTMLSpanElement>(".waiting-player-name")!;
    const badge = item.querySelector<HTMLSpanElement>(".waiting-player-badge")!;
    const status = item.querySelector<HTMLSpanElement>(".player-connection")!;
    setText(name, player.displayName);
    setText(badge, player.isBot ? "🤖 บอท" : player.id === message.ownerId ? "เจ้าของ" : "");
    setText(status, player.isBot ? "พร้อมเล่น" : player.connected ? "● ออนไลน์" : "◌ หลุด");
    if (item.parentElement !== waitingList) {
      waitingList.append(item);
    }
  }
}

function createCard(card: Card | undefined, back: boolean): HTMLDivElement {
  const element = document.createElement("div");
  element.className = back ? "playing-card back" : "playing-card";
  if (back) {
    element.setAttribute("aria-label", "ไพ่ปิด");
    const mark = document.createElement("span");
    mark.className = "card-back-mark";
    mark.textContent = "♠";
    element.append(mark);
    return element;
  }
  if (!card) {
    return element;
  }
  const rank = document.createElement("span");
  rank.className = "card-rank";
  rank.textContent = faceRanks[card.rank] ?? String(card.rank);
  const suit = document.createElement("span");
  suit.className = "card-suit";
  suit.textContent = ({ clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" })[card.suit];
  if (card.suit === "hearts" || card.suit === "diamonds") {
    element.classList.add("red");
  }
  element.setAttribute("aria-label", `${rank.textContent} ${suit.textContent}`);
  element.append(rank, suit);
  return element;
}

function renderCards(
  container: HTMLElement,
  cards: readonly Card[],
  backs = 0,
): void {
  const signature = `${cards.map(({ suit, rank }) => `${suit}-${rank}`).join(",")}|${backs}`;
  if (container.dataset.cards === signature) {
    return;
  }
  container.dataset.cards = signature;
  const elements: HTMLDivElement[] = [];
  for (const card of cards) {
    elements.push(createCard(card, false));
  }
  for (let index = 0; index < backs; index++) {
    elements.push(createCard(undefined, true));
  }
  container.replaceChildren(...elements);
}

function createSeat(): SeatElements {
  const root = document.createElement("div");
  root.className = "seat";
  const name = document.createElement("div");
  name.className = "seat-name";
  const chipCount = document.createElement("span");
  chipCount.className = "seat-meta";
  const status = document.createElement("span");
  status.className = "seat-status";
  const cards = document.createElement("div");
  cards.className = "seat-cards";
  root.append(name, chipCount, status, cards);
  return { root, name, chips: chipCount, status, cards };
}

function renderSeats(message: StateMessage): void {
  const { state, playerNames } = message;
  const playerCount = state.players.length;
  const incomingIds = new Set(state.players.map(({ id }) => id));
  for (const [id, seat] of seats) {
    if (!incomingIds.has(id)) {
      seat.root.remove();
      seats.delete(id);
    }
  }

  state.players.forEach((player, index) => {
    let seat = seats.get(player.id);
    if (!seat) {
      seat = createSeat();
      seats.set(player.id, seat);
    }
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / playerCount;
    const seatX = `${Math.round(Math.cos(angle) * 40)}%`;
    const seatY = `${Math.round(Math.sin(angle) * 39)}%`;
    if (seat.root.style.getPropertyValue("--seat-x") !== seatX) {
      seat.root.style.setProperty("--seat-x", seatX);
    }
    if (seat.root.style.getPropertyValue("--seat-y") !== seatY) {
      seat.root.style.setProperty("--seat-y", seatY);
    }
    seat.root.classList.toggle("is-turn", state.turn === player.id);
    seat.root.classList.toggle("is-folded", player.folded);
    const displayName = playerNames[player.id] ?? "ผู้เล่น";
    setText(
      seat.name,
      message.botPlayerIds.includes(player.id) ? `🤖 ${displayName}` : displayName,
    );
    const chipsText = `${formatChips(player.chips)} ชิป${player.id === state.dealerButton ? " • ปุ่ม" : ""}`;
    setText(seat.chips, chipsText);
    setText(seat.status, player.folded ? "หมอบ" : player.id === state.turn ? "กำลังเล่น" : "");
    const exposedCards = player.id !== state.playerId ? player.holeCards ?? [] : [];
    renderCards(seat.cards, exposedCards, exposedCards.length === 0 && !player.folded && player.id !== state.playerId ? 2 : 0);
    setAttribute(
      seat.root,
      "aria-label",
      `${playerNames[player.id] ?? "ผู้เล่น"} ${player.folded ? "หมอบ" : player.id === state.turn ? "ถึงตา" : ""}`,
    );
    if (seat.root.parentElement !== seatRing) {
      seatRing.append(seat.root);
    }
  });
}

function updateRaiseInputs(minimum: number, maximum: number, enabled: boolean): void {
  const validMaximum = Math.max(minimum, maximum);
  for (const input of [raiseRange, raiseNumber]) {
    if (input.min !== String(minimum)) {
      input.min = String(minimum);
    }
    if (input.max !== String(validMaximum)) {
      input.max = String(validMaximum);
    }
    setDisabled(input, !enabled || maximum < minimum);
  }
  const current = Math.min(validMaximum, Math.max(minimum, Number(raiseNumber.value) || minimum));
  if (raiseRange.value !== String(current)) {
    raiseRange.value = String(current);
  }
  if (raiseNumber.value !== String(current)) {
    raiseNumber.value = String(current);
  }
  setText(raiseOutput, formatChips(current));
  setDisabled(raiseButton, !enabled || maximum < minimum);
}

function renderActions(state: PlayerView): void {
  const available = getActionAvailability(state, state.playerId);
  const isTurn = state.turn === state.playerId && state.stage !== "showdown";
  setDisabled(foldButton, !available.canFold);
  setDisabled(checkButton, !available.canCheck);
  setDisabled(callButton, !available.canCall);
  setText(callButton, available.callAmount > 0
    ? `คอล ${formatChips(available.callAmount)}`
    : "คอล");
  setText(actionHint, isTurn
    ? available.callAmount > 0
      ? `เดิมพันปัจจุบัน ${formatChips(state.currentBet)} ชิป • ต้องคอล ${formatChips(available.callAmount)}`
      : "ไม่มีเดิมพันเพิ่ม เลือกเช็คหรือเรส"
    : state.stage === "showdown" ? "มือจบแล้ว" : "รอผู้เล่นที่ถึงตา");
  updateRaiseInputs(
    available.minimumRaiseTo,
    available.maximumRaiseTo,
    isTurn && available.canRaise,
  );
  updateRaiseButton(state);
}

function updateRaiseButton(state: PlayerView): void {
  const available = getActionAvailability(state, state.playerId);
  const raiseTo = Number(raiseNumber.value);
  setDisabled(
    raiseButton,
    !available.canRaise ||
      !Number.isInteger(raiseTo) ||
      raiseTo < available.minimumRaiseTo ||
      raiseTo > available.maximumRaiseTo,
  );
}

function renderShowdown(message: StateMessage): void {
  const { state, handCategories, playerNames } = message;
  const isOver = state.stage === "showdown";
  setHidden(showdownPanel, !isOver);
  if (!isOver) {
    return;
  }
  const winnerNames = state.winners.map((id) => playerNames[id] ?? "ผู้เล่น");
  setText(winnerMessage, winnerNames.length > 1
    ? `เสมอกัน: ${winnerNames.join(" และ ")}`
    : `${winnerNames[0] ?? "ไม่มีผู้ชนะ"} ชนะ!`);
  const winnerCategories = [...new Set(state.winners
    .map((id) => getHandCategoryLabel(handCategories?.[id]))
    .filter((category): category is string => Boolean(category)))];
  setText(handResult, winnerCategories.length > 0
    ? `ประเภทมือ: ${winnerCategories.join(" / ")}`
    : "ผู้เล่นอื่นหมอบ • ชนะโดยไม่ต้องเปิดไพ่");
}

function renderGame(message: StateMessage): void {
  const fingerprint = JSON.stringify(message);
  if (fingerprint === lastStateFingerprint) {
    return;
  }
  lastStateFingerprint = fingerprint;
  const { state } = message;
  setText(gameRoomCode, message.roomCode);
  setText(gameStage, getStageLabel(state.stage));
  setText(potValue, formatChips(state.pot));
  setText(boardHint, state.board.length === 0 ? "รอเปิดไพ่กลาง" : `${state.board.length} ใบกลางโต๊ะ`);
  setText(turnIndicator, state.turn === state.playerId
    ? "★ ถึงตาคุณ"
    : state.turn && message.botPlayerIds.includes(state.turn)
      ? `🤖 ${message.playerNames[state.turn] ?? "บอท"} กำลังคิด`
      : state.turn
        ? `⌛ ตา ${message.playerNames[state.turn] ?? "ผู้เล่น"}`
        : "✓ จบเกม");
  const isMine = String(state.turn === state.playerId);
  if (turnIndicator.dataset.mine !== isMine) {
    turnIndicator.dataset.mine = isMine;
  }

  renderCards(communityCards, state.board);
  const self = state.players.find(({ id }) => id === state.playerId);
  renderCards(myCards, self?.holeCards ?? []);
  setText(myChipCount, `${formatChips(self?.chips ?? 0)} ชิป`);
  renderSeats(message);
  renderActions(state);
  renderShowdown(message);

  if (state.turn === state.playerId && lastRenderedTurn !== state.playerId) {
    playTone(660, .12);
  }
  if (state.stage === "showdown" && lastRenderedTurn !== "showdown") {
    playTone(880, .22);
  }
  lastRenderedTurn = state.stage === "showdown" ? "showdown" : state.turn;
}

function playTone(frequency: number, duration: number): void {
  if (!soundEnabled || !audioContext || audioContext.state !== "running" || document.hidden) {
    return;
  }
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.055, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function unlockSound(): void {
  if (!audioContext && "AudioContext" in window) {
    audioContext = new AudioContext();
  }
  if (audioContext?.state === "suspended") {
    void audioContext.resume();
  }
}

function playerName(): string {
  return playerNameInput.value.trim().replace(/\s+/g, " ");
}

function createRoom(): void {
  clearError();
  const displayName = playerName();
  const startingChips = Number(startingChipsInput.value);
  if (!displayName || displayName.length > 24) {
    showHomeError("กรุณาใส่ชื่อ 1–24 ตัวอักษร");
    playerNameInput.focus();
    return;
  }
  if (!Number.isSafeInteger(startingChips) || startingChips < 1) {
    showHomeError("เงินเริ่มต้นต้องเป็นจำนวนเต็มตั้งแต่ 1 ชิป");
    startingChipsInput.focus();
    return;
  }
  try {
    localStorage.setItem(nameKey, displayName);
  } catch {
    showError("บันทึกชื่อบนอุปกรณ์ไม่ได้");
  }
  send({ type: "create_room", startingChips, displayName });
}

function joinRoom(): void {
  clearError();
  const displayName = playerName();
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (!displayName || displayName.length > 24) {
    showHomeError("กรุณาใส่ชื่อ 1–24 ตัวอักษร");
    playerNameInput.focus();
    return;
  }
  if (!/^[A-HJ-NP-Z]{4}$/.test(roomCode)) {
    showHomeError("กรุณาใส่รหัสห้อง 4 ตัวอักษร");
    roomCodeInput.focus();
    return;
  }
  try {
    localStorage.setItem(nameKey, displayName);
  } catch {
    showError("บันทึกชื่อบนอุปกรณ์ไม่ได้");
  }
  send({ type: "join_room", roomCode, displayName });
}

function setActionButtons(): void {
  send({ type: "action", action: { type: "fold" } });
}

$("#create-room").addEventListener("click", createRoom);
$("#join-room").addEventListener("click", joinRoom);
$("#room-form").addEventListener("submit", (event) => {
  event.preventDefault();
  joinRoom();
});
startButton.addEventListener("click", () => send({ type: "start_game" }));
addBotButton.addEventListener("click", () => send({ type: "add_bot" }));
foldButton.addEventListener("click", setActionButtons);
checkButton.addEventListener("click", () => send({ type: "action", action: { type: "check" } }));
callButton.addEventListener("click", () => send({ type: "action", action: { type: "call" } }));
raiseButton.addEventListener("click", () => {
  send({
    type: "action",
    action: { type: "raise", amount: Number(raiseNumber.value) },
  });
});
raiseRange.addEventListener("input", () => {
  raiseNumber.value = raiseRange.value;
  setText(raiseOutput, formatChips(Number(raiseRange.value)));
});
raiseNumber.addEventListener("input", () => {
  const value = Number(raiseNumber.value);
  if (raiseNumber.value !== "" && Number.isFinite(value)) {
    raiseRange.value = String(value);
    setText(raiseOutput, formatChips(value));
    if (latestStateMessage) {
      updateRaiseButton(latestStateMessage.state);
    }
  } else {
    setText(raiseOutput, "—");
    setDisabled(raiseButton, true);
  }
});
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z]/g, "").slice(0, 4);
});
$("#copy-room-code").addEventListener("click", () => {
  void navigator.clipboard.writeText(waitingCode.textContent ?? "").then(
    () => showNotice("คัดลอกรหัสห้องแล้ว"),
    () => showError("คัดลอกรหัสไม่ได้ กรุณาจดรหัสไว้"),
  );
});
soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggle.setAttribute("aria-label", soundEnabled ? "ปิดเสียง" : "เปิดเสียง");
  setText(soundToggle, soundEnabled ? "เสียง: เปิด" : "เสียง: ปิด");
  if (soundEnabled) {
    unlockSound();
    playTone(520, .08);
  }
});
document.addEventListener("pointerdown", unlockSound, { once: true });
document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("page-hidden", document.hidden);
});

try {
  const rememberedName = localStorage.getItem(nameKey);
  if (rememberedName) {
    playerNameInput.value = rememberedName;
  } else if (credentials) {
    playerNameInput.value = credentials.displayName;
  }
} catch {
  showError("อ่านข้อมูลที่บันทึกไว้ไม่ได้");
}

if (credentials) {
  showWaiting();
  setText(waitingCode, credentials.roomCode);
  setConnectionStatus("connecting", "กำลังต่อกลับเข้าห้องเดิม…");
} else {
  showHome();
}
connect();
