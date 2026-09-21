"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WavelengthDial } from "@/components/dial/WavelengthDial";
import type { GuessMarker } from "@/components/dial/GuessMarkers";
import { Leaderboard, type LeaderboardRow } from "@/components/game/Leaderboard";
import type { RoomStateDto } from "@/lib/server/roomState";
import { useRoom, useStore } from "@/lib/realtime/useRoom";

import { Lobby } from "./Lobby";
import { RoundPanel } from "./RoundPanel";

export function RoomClient({ initial }: { initial: RoomStateDto }) {
  const router = useRouter();
  const room = useRoom(initial);
  const { state } = room;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Where this player's own needle sits before they commit. Tagged with its
   * round so a new round starts at the centre without an effect resetting it
   * — which would be a cascading render for something derivable.
   */
  const [needle, setNeedle] = useState<{ roundId: string; position: number } | null>(null);

  /**
   * The Psychic's copy of the target.
   *
   * Fetched HERE, in a client component after hydration — never during SSR,
   * because RSC output is serialised into the page HTML and the secret would
   * end up in the document. Held in component state rather than the shared
   * store so it never appears in anything devtools enumerates, and tagged
   * with its round so a stale one can never be shown against a new one.
   */
  const [target, setTarget] = useState<{ roundId: string; value: number } | null>(null);
  const fetchedFor = useRef<string | null>(null);

  useStore(room.needleStore);

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

  useEffect(() => {
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

  const leave = () => {
    void call(`/api/rooms/${state.room.id}/leave`).then((ok) => {
      if (ok) router.push("/");
    });
  };

  const colourIndexOf = useMemo(() => {
    const order = new Map(state.players.map((player, index) => [player.id, index]));
    return (playerId: string) => order.get(playerId) ?? 0;
  }, [state.players]);

  if (state.room.status === "lobby" || state.round === null) {
    return (
      <main className="min-h-dvh bg-stone-950 px-4 py-8">
        <Lobby
          state={state}
          online={room.onlinePlayerIds}
          busy={busy}
          error={error}
          onStart={() => void call(`/api/rooms/${state.room.id}/start`)}
          onLeave={leave}
        />
      </main>
    );
  }

  const round = state.round;
  const myNeedle = needle?.roundId === round.id ? needle.position : 0.5;
  const revealed = round.revealedTarget !== null;
  const iHaveGuessed = state.guesses.some((g) => g.playerId === state.me.playerId);
  const canGuess = round.phase === "guess" && !isPsychic && !iHaveGuessed && !revealed;

  const targetForDial = revealed
    ? round.revealedTarget
    : isPsychic && target?.roundId === round.id
      ? target.value
      : null;

  const markers: GuessMarker[] = revealed
    ? state.guesses
        .filter((guess) => guess.position >= 0)
        .map((guess) => ({
          playerId: guess.playerId,
          name: state.players.find((p) => p.id === guess.playerId)?.displayName ?? "?",
          position: guess.position,
          points: guess.points,
          isMe: guess.playerId === state.me.playerId,
        }))
    : [];

  const rows: LeaderboardRow[] = state.players.map((player) => {
    const guess = state.guesses.find((g) => g.playerId === player.id);
    return {
      playerId: player.id,
      name: player.displayName,
      score: player.score,
      isPsychic: player.id === round.psychicPlayerId,
      isMe: player.id === state.me.playerId,
      hasGuessed: guess !== undefined,
      roundPoints: guess?.points ?? null,
      colourIndex: colourIndexOf(player.id),
    };
  });

  const winner = state.players.find((p) => p.score >= state.room.winningScore);

  return (
    <main
      className="min-h-dvh bg-stone-950 px-3 py-4 sm:px-6 sm:py-8"
      data-round-id={round.id}
      data-room-id={state.room.id}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-sm tracking-widest text-stone-500">
            {state.room.code}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={leave}
              className="text-xs text-stone-500 underline underline-offset-4 hover:text-stone-300"
            >
              Leave
            </button>
            <p className="text-xs text-stone-500">
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${
                  room.connected ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              Round {round.roundNumber}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-stone-900/60 p-2 sm:p-4">
          <WavelengthDial
            leftLabel={round.card.left}
            rightLabel={round.card.right}
            needlePosition={myNeedle}
            targetCenter={targetForDial}
            markTargetCentre={revealed}
            guesses={markers}
            screenOpen={revealed || (isPsychic && round.phase === "clue")}
            interactive={canGuess}
            onChange={(position) => {
              setNeedle({ roundId: round.id, position });
              room.sendNeedle(position);
            }}
            onLock={() => {
              if (canGuess) void call(`/api/rounds/${round.id}/guess`, { position: myNeedle });
            }}
          />
        </div>

        {round.clue !== null && (
          <p className="text-center text-2xl font-bold text-white sm:text-3xl">
            &ldquo;{round.clue}&rdquo;
          </p>
        )}

        <RoundPanel
          state={state}
          round={round}
          isPsychic={isPsychic}
          iHaveGuessed={iHaveGuessed}
          canGuess={canGuess}
          revealed={revealed}
          winner={winner ?? null}
          busy={busy}
          myNeedle={myNeedle}
          onSubmitClue={(clue) => void call(`/api/rounds/${round.id}/clue`, { clue })}
          onLockGuess={() => void call(`/api/rounds/${round.id}/guess`, { position: myNeedle })}
          onForceReveal={() => void call(`/api/rounds/${round.id}/force-reveal`)}
          onNextRound={() => void call(`/api/rooms/${state.room.id}/next-round`)}
          onRestart={() => void call(`/api/rooms/${state.room.id}/restart`)}
        />

        <Leaderboard
          rows={rows}
          target={state.room.winningScore}
          showRoundPoints={revealed}
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
