"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { RoomStateDto } from "@/lib/server/roomState";
import { quantizePosition } from "@/lib/game/geometry";

import { authenticateForRoom, browserClient } from "./client";
import { createStore, useStore, type Store } from "./store";

/**
 * Realtime, split by how often each thing changes.
 *
 *   postgres_changes  durable state — phase, clue, lock, prediction, reveal,
 *                     scores, roster. Ordered, RLS-checked, and it *is* the
 *                     state, so there is no second copy to keep in sync.
 *   broadcast         the needle while it is being dragged. No database write
 *                     at all; persisting 20 rows a second would be WAL churn
 *                     for data that is worthless a frame later.
 *   presence          who is connected. Cleans itself up when a socket drops,
 *                     so no server-side reaper is needed.
 */

const NEEDLE_HZ = 20;
const NEEDLE_INTERVAL_MS = 1000 / NEEDLE_HZ;
/** Refresh the room token a few minutes before it lapses. */
const TOKEN_REFRESH_MARGIN_MS = 3 * 60 * 1000;
const PEER_ECHO_TIMEOUT_MS = 700;

export interface NeedleState {
  readonly position: number;
  /** Monotonic per sender, so a late message cannot rubber-band the dial. */
  readonly seq: number;
  readonly byPlayerId: string | null;
}

export interface UseRoomResult {
  readonly state: RoomStateDto;
  readonly connected: boolean;
  readonly onlinePlayerIds: ReadonlySet<string>;
  readonly needleStore: Store<NeedleState>;
  readonly refresh: () => Promise<void>;
  sendNeedle(position: number): void;
}

export function useRoom(initial: RoomStateDto): UseRoomResult {
  const [state, setState] = useState<RoomStateDto>(initial);
  const [connected, setConnected] = useState(false);
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

  // --- durable state ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      const token = await authenticateForRoom(roomId);
      if (cancelled) return;

      const supabase = browserClient();
      const db = supabase
        .channel(`db:room:${roomId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rounds", filter: `room_id=eq.${roomId}` },
          () => void refresh(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
          () => void refresh(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "games", filter: `room_id=eq.${roomId}` },
          () => void refresh(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          () => void refresh(),
        )
        .subscribe((status) => setConnected(status === "SUBSCRIBED"));

      // Re-mint before expiry; otherwise reads start 401ing mid-game.
      refreshTimer = setTimeout(
        () => void connect(),
        Math.max(30_000, token.expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS),
      );

      return () => void supabase.removeChannel(db);
    }

    const teardown = connect();
    return () => {
      cancelled = true;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      void teardown.then((fn) => fn?.());
    };
  }, [roomId, refresh]);

  // --- needle broadcast + presence ---------------------------------------
  useEffect(() => {
    const supabase = browserClient();
    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: playerId }, broadcast: { self: false } },
    });

    channel
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
  }, [roomId, playerId, needleStore]);

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

  // A tab that was backgrounded may have missed messages; resync on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { state, connected, onlinePlayerIds, needleStore, refresh, sendNeedle };
}

export { useStore };
