import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import { RoomService } from "./rooms";

type ConnectionData = { connectionId: string };

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new RangeError("PORT must be an integer between 1 and 65535");
}

const publicDirectory = resolve(import.meta.dir, "..", "public");
const sockets = new Map<string, ServerWebSocket<ConnectionData>>();
const rooms = new RoomService({
  maxRooms: 100,
  maxMessagesPerWindow: 30,
  rateLimitWindowMs: 10_000,
  disconnectWaitMs: 60_000,
  emptyRoomTtlMs: 30 * 60_000,
});

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function sendDeliveries(
  deliveries: ReturnType<RoomService["runMaintenance"]>,
): void {
  for (const { connectionId, message } of deliveries) {
    const socket = sockets.get(connectionId);
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  }
}

async function servePublicFile(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Invalid path", { status: 400 });
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }
  const filePath = resolve(publicDirectory, `.${pathname}`);
  const relativePath = relative(publicDirectory, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  const headers = {
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  };
  return request.method === "HEAD"
    ? new Response(null, { headers })
    : new Response(file, { headers });
}

const server = Bun.serve<ConnectionData>({
  port,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(request, { data: { connectionId: crypto.randomUUID() } })) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return servePublicFile(request);
  },
  websocket: {
    open(socket) {
      sockets.set(socket.data.connectionId, socket);
    },
    message(socket, message) {
      sendDeliveries(rooms.handleMessage(socket.data.connectionId, message));
    },
    close(socket) {
      sockets.delete(socket.data.connectionId);
      sendDeliveries(rooms.disconnect(socket.data.connectionId));
    },
  },
});

setInterval(() => {
  sendDeliveries(rooms.runMaintenance());
}, 1_000);

console.log(`Poker server listening on http://localhost:${server.port}`);
