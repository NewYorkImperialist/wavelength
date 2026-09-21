"use client";

import { useState } from "react";

import { MAX_CLUE_LENGTH } from "@/lib/game/constants";
import type { PublicRoundDto } from "@/lib/server/mappers";
import type { RoomStateDto } from "@/lib/server/roomState";

export interface RoundPanelProps {
  state: RoomStateDto;
  round: PublicRoundDto;
  isPsychic: boolean;
  iHaveGuessed: boolean;
  canGuess: boolean;
  revealed: boolean;
  winner: { id: string; displayName: string; score: number } | null;
  busy: boolean;
  myNeedle: number;
  onSubmitClue: (clue: string) => void;
  onLockGuess: () => void;
  onForceReveal: () => void;
  onNextRound: () => void;
  onRestart: () => void;
}

const Panel = ({ children }: { children: React.ReactNode }) => (
  <section className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
    {children}
  </section>
);

/** What you see depends only on your role and the phase. */
export function RoundPanel(props: RoundPanelProps) {
  const { state, round, isPsychic, iHaveGuessed, canGuess, revealed, winner, busy } = props;
  const [clue, setClue] = useState("");

  const psychicName =
    state.players.find((p) => p.id === round.psychicPlayerId)?.displayName ?? "someone";

  // ---- game over ---------------------------------------------------------
  if (revealed && winner !== null) {
    return (
      <Panel>
        <p className="text-sm uppercase tracking-widest text-stone-400">Winner</p>
        <p className="mt-1 text-4xl font-bold text-white">{winner.displayName}</p>
        <p className="mt-2 text-stone-400">{winner.score} points</p>
        {state.me.isHost ? (
          <button
            type="button"
            onClick={props.onRestart}
            disabled={busy}
            className="mt-5 rounded-xl bg-white px-6 py-3 font-bold text-stone-900 disabled:opacity-40"
          >
            Play again
          </button>
        ) : (
          <p className="mt-5 text-sm text-stone-500">
            Waiting for the host to start another game…
          </p>
        )}
      </Panel>
    );
  }

  // ---- reveal ------------------------------------------------------------
  if (revealed) {
    const mine = state.guesses.find((g) => g.playerId === state.me.playerId);
    return (
      <div className="flex flex-col gap-3">
        <Panel>
          <p aria-live="polite" className="text-stone-300">
            {isPsychic
              ? `Your clue averaged ${
                  state.players.find((p) => p.id === state.me.playerId)?.score ?? 0
                } points overall.`
              : mine === undefined
                ? "You didn't lock in for this one."
                : mine.points === 0
                  ? "Missed the target."
                  : `You scored ${mine.points}.`}
          </p>
        </Panel>
        <button
          type="button"
          onClick={props.onNextRound}
          disabled={busy}
          className="rounded-xl bg-white px-6 py-3 text-lg font-bold text-stone-900 disabled:opacity-40"
        >
          Next round
        </button>
      </div>
    );
  }

  // ---- the Psychic writes a clue -----------------------------------------
  if (round.phase === "clue") {
    if (!isPsychic) {
      return (
        <Panel>
          <p className="text-stone-400" aria-live="polite">
            {psychicName} is looking at the target…
          </p>
        </Panel>
      );
    }
    return (
      <Panel>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmitClue(clue);
            setClue("");
          }}
        >
          <label
            htmlFor="clue"
            className="block text-sm font-semibold uppercase tracking-wide text-stone-400"
          >
            Your clue
          </label>
          <p className="mt-1 text-sm text-stone-500">
            One word or phrase that belongs where the target is. Everyone else
            guesses on their own — you score the average of how they do.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              id="clue"
              value={clue}
              onChange={(e) => setClue(e.target.value)}
              maxLength={MAX_CLUE_LENGTH}
              autoComplete="off"
              placeholder="e.g. Batman"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-3 text-white placeholder:text-stone-500 focus:border-white/40 focus:outline-none"
            />
            <button
              type="submit"
              disabled={clue.trim().length === 0 || busy}
              className="shrink-0 rounded-lg bg-white px-5 py-3 font-bold text-stone-900 disabled:opacity-40"
            >
              Give clue
            </button>
          </div>
        </form>
      </Panel>
    );
  }

  // ---- everyone places their own needle ----------------------------------
  const waiting = state.players.filter(
    (p) => p.id !== round.psychicPlayerId && !state.guesses.some((g) => g.playerId === p.id),
  );

  if (isPsychic) {
    return (
      <div className="flex flex-col gap-3">
        <Panel>
          <p className="text-stone-400" aria-live="polite">
            {waiting.length === 0
              ? "Everyone's locked in."
              : `Waiting on ${waiting.map((p) => p.displayName).join(", ")}. Say nothing.`}
          </p>
        </Panel>
        {state.me.isHost && waiting.length > 0 && (
          <button
            type="button"
            onClick={props.onForceReveal}
            disabled={busy}
            className="rounded-xl border border-white/20 px-6 py-3 font-semibold text-stone-300 hover:bg-white/10 disabled:opacity-40"
          >
            Reveal without them
          </button>
        )}
      </div>
    );
  }

  if (iHaveGuessed) {
    return (
      <Panel>
        <p className="text-stone-400" aria-live="polite">
          Locked in.{" "}
          {waiting.length === 0
            ? "Revealing…"
            : `Waiting on ${waiting.map((p) => p.displayName).join(", ")}.`}
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <p className="text-stone-300">
        Drag the needle to where you think &ldquo;{round.clue}&rdquo; belongs.
      </p>
      <p className="mt-1 text-sm text-stone-500">
        Everyone guesses for themselves — nobody sees yours until the reveal.
      </p>
      <button
        type="button"
        onClick={props.onLockGuess}
        disabled={!canGuess || busy}
        className="mt-4 rounded-xl bg-white px-8 py-3 text-lg font-bold text-stone-900 disabled:opacity-40"
      >
        Lock in my guess
      </button>
    </Panel>
  );
}
