"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { getCardById, type SpectrumCard } from "@/lib/game/deck";
import {
  createInitialRoom,
  transition,
  type GameAction,
  type TransitionError,
} from "@/lib/game/state-machine";
import type { RoomState, TeamId } from "@/lib/game/types";
import { runEffects, type RunnerDeps } from "./runner";

export interface LocalPlayerSeed {
  readonly name: string;
  readonly team: TeamId;
}

/**
 * Runs a complete game on one device.
 *
 * The engine is pure and emits `Effect`s rather than doing anything; this hook
 * is the interpreter for them. `prepareRound` is where randomness enters —
 * exactly the job the server will do in multiplayer, which is why the engine
 * itself never calls `Math.random`.
 */
export function useLocalGame() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [lastError, setLastError] = useState<TransitionError | null>(null);
  /** Hot-seat only: has the psychic confirmed nobody else is looking? */
  const [psychicRevealed, setPsychicRevealed] = useState(false);
  const roomRef = useRef<RoomState | null>(null);

  const commit = useCallback((next: RoomState) => {
    roomRef.current = next;
    setRoom(next);
  }, []);

  const deps = useMemo<RunnerDeps>(() => ({ rng: Math.random }), []);

  const dispatch = useCallback(
    (action: GameAction) => {
      const current = roomRef.current;
      if (current === null) return;

      const result = transition(current, action);
      if (!result.ok) {
        setLastError(result.error);
        return;
      }
      setLastError(null);
      if (action.type === "acknowledgeReveal" || action.type === "startGame") {
        setPsychicRevealed(false);
      }
      commit(runEffects(result.state, result.effects, deps));
    },
    [commit, deps],
  );

  const start = useCallback(
    (players: readonly LocalPlayerSeed[]) => {
      const first = players[0];
      if (first === undefined) return;

      let next = createInitialRoom("p0", first.name, 0);
      // createInitialRoom seats the host on team A; move them if asked.
      if (first.team !== "teamA") {
        const moved = transition(next, {
          type: "setTeam", by: "p0", playerId: "p0", team: first.team,
        });
        if (moved.ok) next = moved.state;
      }

      players.slice(1).forEach((player, index) => {
        const result = transition(next, {
          type: "playerJoined",
          playerId: `p${index + 1}`,
          name: player.name,
          team: player.team,
          at: index + 1,
        });
        if (result.ok) next = result.state;
      });

      const started = transition(next, { type: "startGame", by: "p0" });
      if (!started.ok) {
        setLastError(started.error);
        commit(next);
        return;
      }
      setLastError(null);
      setPsychicRevealed(false);
      commit(runEffects(started.state, started.effects, deps));
    },
    [commit, deps],
  );

  const reset = useCallback(() => {
    roomRef.current = null;
    setRoom(null);
    setLastError(null);
    setPsychicRevealed(false);
  }, []);

  const card: SpectrumCard | null = useMemo(() => {
    const id = room?.public.round?.cardId;
    return id === undefined ? null : (getCardById(id) ?? null);
  }, [room]);

  return {
    room,
    card,
    lastError,
    psychicRevealed,
    showTargetToPsychic: () => setPsychicRevealed(true),
    dispatch,
    start,
    reset,
  };
}
