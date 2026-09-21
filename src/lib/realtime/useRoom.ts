"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { RoomStateDto } from "@/lib/server/roomState";
import { quantizePosition } from "@/lib/game/geometry";

import { browserClient } from "./client";
import { createStore, useStore, type Store } from "./store";

/**
 * Realtime, on one channel, carrying three kinds of message.
 *
 *   changed      a bare ping from the server after any mutation. No data:
 *                clients react by re-fetching the bootstrap endpoint, which
 *                is the single place that decides what a player may see.
 *   needle:move  the dial while it is being dragged, client to client, at
 *                20Hz with no database write. Persisting 20 rows a second
 *                would be WAL churn for values worthless a frame later.
 *   presence     who is connected. Cleans itself up when a socket drops, so
 *                no server-side reaper is needed.
 *
 * Deliberately NOT postgres_changes. Those require the browser to hold a
 * token whose claims satisfy the RLS policies, which means minting and
 * refreshing custom JWTs signed with the project's JWT secret. Since the
 * client never reads Supabase directly, that machinery bought nothing — and
 * a bare ping cannot leak, where a row payload can.
 */

const NEEDLE_HZ = 20;
const NEEDLE_INTERVAL_MS = 1000 / NEEDLE_HZ;
const PEER_ECHO_TIMEOUT_MS = 700;
/**
 * How often to poll when realtime is not carrying updates.
 *
 * Realtime can be unavailable for ordinary reasons — a blocked WebSocket on a
 * corporate network, a dropped connection, a self-hosted stack without the
 * Realtime service. The game must still be playable, just less instant, so
 * the bootstrap endpoint is polled instead. Phase changes, clues, locks and
 * scores all arrive; only live needle dragging is lost, and the locked
 * position is authoritative anyway.
 */
const FALLBACK_POLL_MS = 2000;
/**
 * Only once realtime has actually *delivered* something do we back off.
 *
 * A subscription reporting SUBSCRIBED is not the same as one delivering
 * changes: a channel can join happily and still carry nothing, which leaves a
 * player watching a stale lobby while everyone else has moved on. So the
 * trigger for slowing down is a received message, not a connection status.
 */
const HEALTHY_POLL_MS = 15_000;

export interface NeedleState {
  readonly position: number;
  /** Monotonic per sender, so a late message cannot rubber-band the dial. */
  readonly seq: number;
  readonly byPlayerId: string | null;
}

export interface UseRoomResult {
  readonly state: RoomStateDto;
  /** The socket is up. Does NOT imply changes are arriving — see `delivering`. */
  readonly connected: boolean;
  /** A realtime change has actually been received at least once. */
  readonly delivering: boolean;
  readonly onlinePlayerIds: ReadonlySet<string>;
  readonly needleStore: Store<NeedleState>;
  readonly refresh: () => Promise<void>;
  sendNeedle(position: number): void;
}

export function useRoom(initial: RoomStateDto): UseRoomResult {
  const [state, setState] = useState<RoomStateDto>(initial);
  const [connected, setConnected] = useState(false);
  /** Set the first time a realtime change actually arrives. */
  const [delivering, setDelivering] = useState(false);
  const [onlinePlayerIds, setOnline] = useState<ReadonlySet<string>>(new Set());

  const roomId = initial.room.id;
  const playerId = initial.me.playerId;

  // The needle lives outside React state so dragging doesn't re-render the
  // rest of the room twenty times a second.
  const needleStore = useMemo(
    () =>
      createStore<NeedleState>({
        position: initial.round?.needlePosition ?? 0.5,
        seq: 0,
        byPlayerId: null,
      }),
    [initial.round?.needlePosition],
  );

  const channelRef = useRef<RealtimeChannel | null>(null);
  const seqRef = useRef(0);
  const lastSentAt = useRef(0);
  const pendingSend = useRef<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/rooms/${roomId}/state`, { cache: "no-store" });
    if (!response.ok) return;
    setState((await response.json()) as RoomStateDto);
  }, [roomId]);

  // --- one channel: change pings, the needle, and presence ----------------
  useEffect(() => {
    let supabase;
    try {
      supabase = browserClient();
    } catch {
      // No Supabase configured at all: the needle simply will not sync live.
      return;
    }
    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: playerId }, broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "changed" }, () => {
        setDelivering(true);
        void refresh();
      })
      .on("broadcast", { event: "needle:move" }, ({ payload }) => {
        const move = payload as NeedleState;
        // Drop anything older than what we've already applied.
        needleStore.set((current) =>
          move.seq <= current.seq && move.byPlayerId === current.byPlayerId
            ? current
            : { ...move, position: quantizePosition(move.position) },
        );
      })
      .on("broadcast", { event: "needle:request" }, () => {
        // Someone just joined or refreshed. Echo the live position back, since
        // it is deliberately not in the database.
        const current = needleStore.get();
        if (current.byPlayerId === null) return;
        void channel.send({ type: "broadcast", event: "needle:move", payload: current });
      })
      .on("presence", { event: "sync" }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status !== "SUBSCRIBED") return;
        void channel.track({ playerId, at: Date.now() });
        // Ask peers where the needle is; fall back to the dial centre.
        void channel.send({
          type: "broadcast",
          event: "needle:request",
          payload: { requesterId: playerId },
        });
        setTimeout(() => {
          if (needleStore.get().byPlayerId === null) {
            needleStore.set((c) => ({ ...c, position: c.position }));
          }
        }, PEER_ECHO_TIMEOUT_MS);
      });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [roomId, playerId, needleStore, refresh]);

  /** Apply locally every frame; put it on the wire at most 20 times a second. */
  const sendNeedle = useCallback(
    (position: number) => {
      const next = quantizePosition(position);
      seqRef.current += 1;
      needleStore.set({ position: next, seq: seqRef.current, byPlayerId: playerId });

      const flush = () => {
        lastSentAt.current = Date.now();
        pendingSend.current = null;
        void channelRef.current?.send({
          type: "broadcast",
          event: "needle:move",
          payload: {
            position: needleStore.get().position,
            seq: seqRef.current,
            byPlayerId: playerId,
          },
        });
      };

      const elapsed = Date.now() - lastSentAt.current;
      if (elapsed >= NEEDLE_INTERVAL_MS) {
        flush();
        return;
      }
      // Coalesce: drop stale intermediate positions rather than queueing them.
      pendingSend.current = next;
      if (sendTimer.current === null) {
        sendTimer.current = setTimeout(() => {
          sendTimer.current = null;
          if (pendingSend.current !== null) flush();
        }, NEEDLE_INTERVAL_MS - elapsed);
      }
    },
    [needleStore, playerId],
  );

  // Polling fallback. Fast while realtime is down, slow once it is healthy.
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (document.visibilityState !== "visible") return;
        void refresh();
      },
      delivering ? HEALTHY_POLL_MS : FALLBACK_POLL_MS,
    );
    return () => clearInterval(interval);
  }, [delivering, refresh]);

  // A tab that was backgrounded may have missed messages; resync on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { state, connected, delivering, onlinePlayerIds, needleStore, refresh, sendNeedle };
}

export { useStore };
