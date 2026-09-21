"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { WavelengthDial } from "@/components/dial/WavelengthDial";
import { Scoreboard } from "@/components/game/Scoreboard";
import type { RoomStateDto } from "@/lib/server/roomState";
import { useRoom, useStore } from "@/lib/realtime/useRoom";

import { Lobby } from "./Lobby";
import { RoundPanels } from "./RoundPanels";

export function RoomClient({ initial }: { initial: RoomStateDto }) {
  const room = useRoom(initial);
  const { state } = room;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The Psychic's copy of the target.
   *
   * Fetched HERE, in a client component after hydration — never during SSR,
   * because RSC output is serialised into the page HTML and the secret would
   * end up in the document. Held in component state rather than the shared
   * store so it never appears in anything a devtools panel enumerates.
   */
  const [target, setTarget] = useState<{ roundId: string; value: number } | null>(null);
  const fetchedFor = useRef<string | null>(null);

  const needle = useStore(room.needleStore);

  const call = useCallback(
    async (url: string, body?: unknown): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as { message?: string };
          setError(detail.message ?? "That didn't work.");
          return false;
        }
        await room.refresh();
        return true;
      } catch {
        setError("Could not reach the server.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [room],
  );

  const roundId = state.round?.id ?? null;
  const isPsychic = state.me.isPsychic;
  const phase = state.round?.phase ?? null;

  // Re-fetches on reconnect and on refresh, which is what makes a mid-round
  // reload safe for the Psychic.
  useEffect(() => {
    // Nothing to do unless this viewer is the Psychic of a live round. The
    // stored target is tagged with its round, so a stale one is filtered out
    // when rendering rather than cleared with a setState from here.
    if (roundId === null || !isPsychic) return;
    if (phase === "reveal" || phase === "complete") return;
    if (fetchedFor.current === roundId) return;

    fetchedFor.current = roundId;
    let cancelled = false;

    void (async () => {
      const response = await fetch(`/api/rounds/${roundId}/target`, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as { targetCenter: number };
      if (!cancelled) setTarget({ roundId, value: body.targetCenter });
    })();

    return () => {
      cancelled = true;
    };
  }, [roundId, isPsychic, phase]);

  // --- lobby --------------------------------------------------------------
  if (state.room.status === "lobby" || state.round === null) {
    return (
      <main className="min-h-dvh bg-stone-950 px-4 py-8">
        <Lobby
          state={state}
          online={room.onlinePlayerIds}
          busy={busy}
          error={error}
          onSwitchTeam={(team) => void call(`/api/rooms/${state.room.id}/team`, { team })}
          onStart={() => void call(`/api/rooms/${state.room.id}/start`)}
        />
      </main>
    );
  }

  const round = state.round;
  const revealed = round.revealedTarget !== null;
  const iAmActive = state.me.team === round.activeTeam;
  const iHoldTheDial =
    round.needleControllerId === state.me.playerId && round.phase === "guess";

  // The dial is only handed a target when this viewer is entitled to one.
  const myTarget = target?.roundId === round.id ? target.value : null;
  const targetForDial = revealed ? round.revealedTarget : isPsychic ? myTarget : null;
  // Locked position wins once it exists; before that, the live broadcast.
  const needlePosition = round.needlePosition ?? needle.position;

  return (
    <main className="min-h-dvh bg-stone-950 px-3 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-sm tracking-widest text-stone-500">
            {state.room.code}
          </p>
          <p className="text-xs text-stone-500">
            <span
              className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${
                room.connected ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {room.connected ? "Connected" : "Reconnecting…"}
          </p>
        </div>

        {state.game !== null && (
          <Scoreboard
            state={{
              config: { winningScore: state.room.winningScore, minPlayersPerTeamToStart: 2 },
              phase: revealed ? "reveal" : "guess",
              activeTeam: round.activeTeam,
              teams: {
                teamA: { id: "teamA", name: "Team A", score: state.game.scoreA, rotation: [], psychicCursor: -1 },
                teamB: { id: "teamB", name: "Team B", score: state.game.scoreB, rotation: [], psychicCursor: -1 },
              },
              version: 0,
              hostId: state.room.hostPlayerId ?? "",
              players: {},
              roundNumber: round.roundNumber,
              round: null,
              suddenDeath: null,
              usedCardIds: [],
              history: [],
              winner: state.game.winner,
            }}
          />
        )}

        {state.game !== null && state.game.suddenDeathIndex > 0 && state.game.winner === null && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-center text-sm font-semibold text-rose-200">
            Sudden death, round {state.game.suddenDeathIndex} — most points this round wins
          </p>
        )}

        <div className="rounded-2xl bg-stone-900/60 p-2 sm:p-4">
          <WavelengthDial
            leftLabel={round.card.left}
            rightLabel={round.card.right}
            needlePosition={needlePosition}
            targetCenter={targetForDial}
            screenOpen={revealed || (isPsychic && round.phase === "clue")}
            interactive={iHoldTheDial}
            onChange={room.sendNeedle}
            onLock={() =>
              void call(`/api/rounds/${round.id}/needle`, {
                action: "lock",
                position: room.needleStore.get().position,
              })
            }
          />
        </div>

        {round.clue !== null && !revealed && (
          <p className="text-center text-2xl font-bold text-white sm:text-3xl">
            &ldquo;{round.clue}&rdquo;
          </p>
        )}

        <RoundPanels
          state={state}
          round={round}
          isPsychic={isPsychic}
          iAmActive={iAmActive}
          iHoldTheDial={iHoldTheDial}
          needlePosition={needlePosition}
          busy={busy}
          onSubmitClue={(clue) => void call(`/api/rounds/${round.id}/clue`, { clue })}
          onClaimDial={() => void call(`/api/rounds/${round.id}/needle`, { action: "claim" })}
          onLock={() =>
            void call(`/api/rounds/${round.id}/needle`, {
              action: "lock",
              position: room.needleStore.get().position,
            })
          }
          onPredict={(side) => void call(`/api/rounds/${round.id}/prediction`, { side })}
          onNextRound={() => void call(`/api/rooms/${state.room.id}/next-round`)}
        />

        {error !== null && (
          <p role="alert" className="text-center text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
