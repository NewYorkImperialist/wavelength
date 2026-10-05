"use client";

import { useCallback, useEffect, useState } from "react";

import type { RoomStateDto } from "@/lib/server/roomState";

/**
 * Realtime over one WebSocket to our own server (`server/index.mjs`), carrying
 * two kinds of message:
 *
 *   changed    a bare ping after any mutation. No data: clients react by
 *              re-fetching the bootstrap endpoint, which is the single place
 *              that decides what a player may see.
 *   presence   who currently has the room open.
 *
 * Dial movements are deliberately NOT relayed. Every player guesses on their
 * own dial, and broadcasting it while they drag would hand a late guesser
 * everyone else's answer — the very thing the bootstrap payload withholds
 * until the reveal.
 */

/**
 * How often to poll when the socket is not carrying updates.
 *
 * A socket can be unavailable for ordinary reasons — a corporate proxy, a
 * phone switching networks, the server restarting for a deploy. The game must
 * still be playable, just less instant, so the bootstrap endpoint is polled.
 */
const FALLBACK_POLL_MS = 2000;
/**
 * Only once the socket has actually *delivered* something do we back off.
 * An open socket is not the same as one delivering changes.
 */
const HEALTHY_POLL_MS = 15_000;
/** Reconnect delay, doubling per failure up to the cap. */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

type ServerMessage =
  | { readonly type: "changed"; readonly reason: string }
  | { readonly type: "presence"; readonly playerIds: readonly string[] };

export interface UseRoomResult {
  readonly state: RoomStateDto;
  /** The socket is up. Does NOT imply changes are arriving — see `delivering`. */
  readonly connected: boolean;
  /** A realtime change has actually been received at least once. */
  readonly delivering: boolean;
  readonly onlinePlayerIds: ReadonlySet<string>;
  readonly refresh: () => Promise<void>;
}

export function useRoom(initial: RoomStateDto): UseRoomResult {
  const [state, setState] = useState<RoomStateDto>(initial);
  const [connected, setConnected] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [onlinePlayerIds, setOnline] = useState<ReadonlySet<string>>(new Set());

  const roomId = initial.room.id;

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/rooms/${roomId}/state`, { cache: "no-store" });
    if (!response.ok) return;
    setState((await response.json()) as RoomStateDto);
  }, [roomId]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = RECONNECT_MIN_MS;
    let stopped = false;

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${scheme}://${window.location.host}/ws?room=${encodeURIComponent(roomId)}`;
      const ws = new WebSocket(url);
      socket = ws;

      ws.onopen = () => {
        delay = RECONNECT_MIN_MS;
        setConnected(true);
        // Anything that happened while disconnected was never announced.
        void refresh();
      };

      ws.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "changed") {
          setDelivering(true);
          void refresh();
        } else if (message.type === "presence") {
          setOnline(new Set(message.playerIds));
        }
      };

      ws.onclose = () => {
        if (socket === ws) socket = null;
        setConnected(false);
        if (stopped) return;
        retryTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [roomId, refresh]);

  // Polling fallback. Fast while realtime is down, slow once it is healthy.
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (document.visibilityState !== "visible") return;
        void refresh();
      },
      delivering && connected ? HEALTHY_POLL_MS : FALLBACK_POLL_MS,
    );
    return () => clearInterval(interval);
  }, [connected, delivering, refresh]);

  // A tab that was backgrounded may have missed messages; resync on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { state, connected, delivering, onlinePlayerIds, refresh };
}
