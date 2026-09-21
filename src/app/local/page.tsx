"use client";

import { useState } from "react";

import { WavelengthDial } from "@/components/dial/WavelengthDial";
import { RoundResultPanel } from "@/components/game/RoundResultPanel";
import { Scoreboard } from "@/components/game/Scoreboard";
import { OPPONENT } from "@/lib/game/state-machine";
import type { TeamId } from "@/lib/game/types";
import { useLocalGame } from "@/lib/local/useLocalGame";

import { LocalSetup } from "./LocalSetup";

export default function LocalGamePage() {
  const game = useLocalGame();
  const [clue, setClue] = useState("");

  if (game.room === null) {
    return (
      <main className="min-h-dvh bg-stone-950 px-4 py-10">
        <LocalSetup onStart={game.start} />
      </main>
    );
  }

  const state = game.room.public;
  const round = state.round;
  const card = game.card;
  const teamNames: Record<TeamId, string> = {
    teamA: state.teams.teamA.name,
    teamB: state.teams.teamB.name,
  };

  const psychicName =
    round === null ? "" : (state.players[round.psychicId]?.name ?? "");
  const controllerName =
    round === null ? "" : (state.players[round.controllerId]?.name ?? "");
  const activeName = teamNames[state.activeTeam];
  const opposingName = teamNames[OPPONENT[state.activeTeam]];

  // The target is only ever handed to the dial when the viewer is entitled to
  // it: the psychic who has confirmed they're alone with the screen, or
  // everyone once the reveal has happened.
  const revealed = state.phase === "reveal" || state.phase === "gameOver";
  const psychicMayLook = state.phase === "clue" && game.psychicRevealed;
  const targetForDial = revealed
    ? (round?.revealedTarget ?? null)
    : psychicMayLook
      ? (game.room.secret?.targetCenter ?? null)
      : null;

  return (
    <main className="min-h-dvh bg-stone-950 px-3 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
        <Scoreboard state={state} />

        {state.suddenDeath !== null && state.phase !== "gameOver" && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-center text-sm font-semibold text-rose-200">
            Sudden death, round {state.suddenDeath.index} — most points this round wins
          </p>
        )}

        <div className="rounded-2xl bg-stone-900/60 p-2 sm:p-4">
          <WavelengthDial
            leftLabel={card?.left ?? ""}
            rightLabel={card?.right ?? ""}
            needlePosition={round?.needlePosition ?? 0.5}
            targetCenter={targetForDial}
            screenOpen={revealed || psychicMayLook}
            interactive={state.phase === "guess"}
            onChange={(position) => {
              if (round === null) return;
              game.dispatch({ type: "moveNeedle", by: round.controllerId, position });
            }}
            onLock={() => {
              if (round === null) return;
              game.dispatch({ type: "lockNeedle", by: round.controllerId });
            }}
          />
        </div>

        {round !== null && round.clue !== null && !revealed && (
          <p className="text-center text-2xl font-bold text-white sm:text-3xl">
            &ldquo;{round.clue}&rdquo;
          </p>
        )}

        {/* ---------------- Psychic writes a clue ---------------- */}
        {state.phase === "clue" && round !== null && (
          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            {!game.psychicRevealed ? (
              <div className="text-center">
                <p className="text-lg text-stone-300">
                  Pass the device to{" "}
                  <span className="font-bold text-white">{psychicName}</span>
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  Everyone else, look away — the target is about to show.
                </p>
                <button
                  type="button"
                  onClick={game.showTargetToPsychic}
                  className="mt-4 rounded-xl bg-white px-6 py-3 font-bold text-stone-900 hover:opacity-90"
                >
                  I&apos;m {psychicName}. Show me the target
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  game.dispatch({ type: "submitClue", by: round.psychicId, clue });
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
                  One word or phrase that sits where the target is. No gestures,
                  and don&apos;t use the words on the dial.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    id="clue"
                    value={clue}
                    onChange={(e) => setClue(e.target.value)}
                    autoComplete="off"
                    placeholder="e.g. Batman"
                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-3 text-white placeholder:text-stone-500 focus:border-white/40 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={clue.trim().length === 0}
                    className="shrink-0 rounded-lg bg-white px-5 py-3 font-bold text-stone-900 disabled:opacity-40"
                  >
                    Give clue
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* ---------------- Active team turns the dial ---------------- */}
        {state.phase === "guess" && round !== null && (
          <section className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
            <p className="text-lg text-stone-300">
              <span className="font-bold text-white">{activeName}</span> — discuss it,
              then <span className="font-bold text-white">{controllerName}</span> turns
              the dial.
            </p>
            <button
              type="button"
              onClick={() => game.dispatch({ type: "lockNeedle", by: round.controllerId })}
              className="mt-4 rounded-xl bg-white px-8 py-3 text-lg font-bold text-stone-900 hover:opacity-90"
            >
              Lock it in
            </button>
          </section>
        )}

        {/* ---------------- Opponents call left or right ---------------- */}
        {state.phase === "prediction" && round !== null && (
          <section className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
            <p className="text-lg text-stone-300">
              <span className="font-bold text-white">{opposingName}</span> — is the
              centre of the target left or right of that needle?
            </p>
            <div className="mt-4 flex justify-center gap-3">
              {(["left", "right"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => {
                    const opponent = state.teams[OPPONENT[state.activeTeam]].rotation[0];
                    if (opponent === undefined) return;
                    game.dispatch({ type: "submitPrediction", by: opponent, side });
                  }}
                  className="min-w-32 rounded-xl border-2 border-white/20 bg-white/5 px-8 py-4 text-xl font-bold uppercase text-white transition-colors hover:border-white/60 hover:bg-white/10"
                >
                  {side}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ---------------- Reveal ---------------- */}
        {revealed && round?.result != null && (
          <section className="flex flex-col gap-4">
            <RoundResultPanel result={round.result} teamNames={teamNames} />
            {state.phase === "reveal" ? (
              <button
                type="button"
                onClick={() => game.dispatch({ type: "acknowledgeReveal", by: "p0" })}
                className="rounded-xl bg-white px-6 py-3 text-lg font-bold text-stone-900 hover:opacity-90"
              >
                Next round
              </button>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
                <p className="text-sm uppercase tracking-widest text-stone-400">Winner</p>
                <p className="mt-1 text-4xl font-bold text-white">
                  {state.winner === null ? "—" : teamNames[state.winner]}
                </p>
                <p className="mt-2 text-stone-400">
                  {state.teams.teamA.name} {state.teams.teamA.score} &middot;{" "}
                  {state.teams.teamB.name} {state.teams.teamB.score}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => game.dispatch({ type: "restartGame", by: "p0" })}
                    className="rounded-xl bg-white px-6 py-3 font-bold text-stone-900 hover:opacity-90"
                  >
                    Play again
                  </button>
                  <button
                    type="button"
                    onClick={game.reset}
                    className="rounded-xl border border-white/20 px-6 py-3 font-bold text-white hover:bg-white/10"
                  >
                    Change players
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Lobby after "play again". */}
        {state.phase === "lobby" && (
          <button
            type="button"
            onClick={() => game.dispatch({ type: "startGame", by: "p0" })}
            className="rounded-xl bg-white px-6 py-3 text-lg font-bold text-stone-900 hover:opacity-90"
          >
            Start the next game
          </button>
        )}

        {game.lastError !== null && (
          <p role="alert" className="text-center text-sm text-rose-300">
            {game.lastError.replaceAll("_", " ").toLowerCase()}
          </p>
        )}
      </div>
    </main>
  );
}
