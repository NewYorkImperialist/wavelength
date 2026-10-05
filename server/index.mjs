/**
 * The production and development entry point: Next.js, plus a WebSocket
 * endpoint at /ws on the same port.
 *
 * Next's route handlers cannot hold a socket open, which is why this custom
 * server exists at all. It does as little as it can: authenticate the socket
 * against the same session cookie the API uses, then hand it to the hub.
 *
 *   pnpm dev     node server/index.mjs
 *   pnpm start   NODE_ENV=production node server/index.mjs
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

import next from "next";
import { WebSocketServer } from "ws";

import { database } from "./database.mjs";
import { hub } from "./hub.mjs";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? (dev ? "localhost" : "0.0.0.0");

/**
 * Fly's proxy, and plenty of home routers, drop connections that look idle.
 * A ping well inside a minute keeps the socket alive and finds dead ones.
 */
const HEARTBEAT_MS = 25_000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();
const upgradeNext = app.getUpgradeHandler();

const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });

/** @type {WeakMap<import("ws").WebSocket, boolean>} */
const alive = new WeakMap();

const server = createServer((req, res) => {
  void handle(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  // Everything else — in development, Next's hot-reload socket — is Next's.
  if (url.pathname !== "/ws") {
    void upgradeNext(req, socket, head);
    return;
  }

  const roomId = url.searchParams.get("room") ?? "";
  const playerId = sameOrigin(req) ? authenticate(req, roomId) : null;
  if (playerId === null) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }

  sockets.handleUpgrade(req, socket, head, (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));

    const leave = hub().join(roomId, {
      playerId,
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    });
    ws.on("close", leave);
    ws.on("error", () => ws.terminate());
    // Clients have nothing to say. Anything they send is ignored.
  });
});

const heartbeat = setInterval(() => {
  for (const ws of sockets.clients) {
    if (alive.get(ws) !== true) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, HEARTBEAT_MS);

server.listen(port, hostname, () => {
  console.log(`> Wavelength on http://${hostname}:${port} (${dev ? "development" : "production"})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    clearInterval(heartbeat);
    for (const ws of sockets.clients) ws.close(1012, "restarting");
    server.close();
    // Folds the WAL back into the main file so a stopped volume is tidy.
    database().close();
    process.exit(0);
  });
}

/**
 * The player behind this socket, from the same httpOnly cookie the API reads,
 * or null. Mirrors `requireActor` in src/lib/server/session.ts: the token's
 * SHA-256 must belong to a player who is still in this room.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {string} roomId
 * @returns {string | null}
 */
function authenticate(req, roomId) {
  if (!/^[0-9a-f-]{36}$/.test(roomId)) return null;

  const token = readCookie(req.headers.cookie ?? "", `wl_s_${roomId.slice(0, 8)}`);
  if (token === null || token === "") return null;

  const hash = createHash("sha256").update(token).digest();
  const row = /** @type {{ id: string } | undefined} */ (
    database()
      .prepare(
        `select p.id from player_sessions s
           join players p on p.id = s.player_id
          where s.token_hash = ? and p.room_id = ? and p.left_at is null`,
      )
      .get(hash, roomId)
  );
  return row?.id ?? null;
}

/**
 * Refuse sockets opened by another site. The session cookie is SameSite=Lax,
 * which browsers already withhold from cross-site socket handshakes; this is
 * the second lock on the same door.
 *
 * @param {import("node:http").IncomingMessage} req
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // Not a browser.
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * @param {string} header
 * @param {string} name
 * @returns {string | null}
 */
function readCookie(header, name) {
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}
