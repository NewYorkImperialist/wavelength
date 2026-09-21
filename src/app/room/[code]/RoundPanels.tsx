"use client";

import { useState } from "react";

import { MAX_CLUE_LENGTH } from "@/lib/game/constants";
import type { PublicRoundDto } from "@/lib/server/mappers";
import type { RoomStateDto } from "@/lib/server/roomState";

/**
 * What each player sees is a function of their role and the phase — the
 * Psychic, the team guessing, the team calling left or right, and everyone
 * else waiting are four genuinely different screens.
 */
export interface RoundPanelsProps {
  state: RoomStateDto;
  round: PublicRoundDto;
  isPsychic: boolean;
  iAmActive: boolean;
  iHoldTheDial: boolean;
  needlePosition: number;
  busy: boolean;
  onSubmitClue: (clue: string) => void;
  onClaimDial: () => void;
  onLock: () => void;
  onPredict: (side: "left" | "right") => void;
  onNextRound: () => void;
}

const Panel = ({ children }: { children: React.ReactNode }) => (
  <section className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
    {children}
  </section>
);

const Waiting = ({ children }: { children: React.ReactNode }) => (
  <Panel>
    <p className="text-stone-400" aria-live="polite">
      {children}
    </p>
  </Panel>
);

export function RoundPanels(props: RoundPanelsProps) {
  const { state, round, isPsychic, iAmActive, iHoldTheDial, busy } = props;
  const [clue, setClue] = useState("");

  const nameOf = (id: string | null): string =>
    state.players.find((p) => p.id === id)?.displayName ?? "someone";
  const psychicName = nameOf(round.psychicPlayerId);

  // ---- reveal ------------------------------------------------------------
  if (round.revealedTarget !== null) {
    const activeWon = (round.activePoints ?? 0) > 0;
    const bonus = round.opponentPoints ?? 0;
    const blocked = round.activePoints === 4;

    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
          <Panel>
            <p className="text-sm uppercase tracking-wide text-stone-400">
              {round.activeTeam === "teamA" ? "Team A" : "Team B"}
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-white">
              +{round.activePoints ?? 0}
            </p>
            <p className="mt-1 text-sm text-stone-400">
              {round.activePoints === 4
                ? "Dead centre"
                : activeWon
                  ? `Landed in the ${round.activePoints}-point band`
                  : "Missed the target"}
            </p>
          </Panel>
          <Panel>
            <p className="text-sm uppercase tracking-wide text-stone-400">
              {round.activeTeam === "teamA" ? "Team B" : "Team A"}
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-white">+{bonus}</p>
            <p className="mt-1 text-sm text-stone-400">
              {round.prediction === null
                ? "No call made"
                : blocked
                  ? `Called ${round.prediction} — a bullseye blocks the bonus`
                  : bonus > 0
                    ? `Correctly called ${round.prediction}`
                    : `Called ${round.prediction} — wrong side`}
            </p>
          </Panel>
        </div>

        {state.game?.winner != null ? (
          <Panel>
            <p className="text-sm uppercase tracking-widest text-stone-400">Winner</p>
            <p className="mt-1 text-4xl font-bold text-white">
              {state.game.winner === "teamA" ? "Team A" : "Team B"}
            </p>
            <p className="mt-2 text-stone-400">
              Team A {state.game.scoreA} &middot; Team B {state.game.scoreB}
            </p>
          </Panel>
        ) : (
          <button
            type="button"
            onClick={props.onNextRound}
            disabled={busy}
            className="rounded-xl bg-white px-6 py-3 text-lg font-bold text-stone-900 disabled:opacity-40"
          >
            Next round
          </button>
        )}
      </div>
    );
  }

  // ---- psychic writes a clue --------------------------------------------
  if (round.phase === "clue") {
    if (!isPsychic) {
      return <Waiting>{psychicName} is looking at the target…</Waiting>;
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
            One word or phrase that belongs where the target is. No gestures,
            and don&apos;t use the words on the dial.
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

  // ---- active team turns the dial ---------------------------------------
  if (round.phase === "guess") {
    if (isPsychic) {
      return <Waiting>Your team is deciding. Say nothing.</Waiting>;
    }
    if (!iAmActive) {
      return (
        <Waiting>
          {round.activeTeam === "teamA" ? "Team A" : "Team B"} is placing the
          needle. Start thinking about left or right.
        </Waiting>
      );
    }
    return (
      <Panel>
        <p className="text-stone-300">
          {iHoldTheDial ? (
            <>You have the dial. Drag the needle, or use the arrow keys.</>
          ) : (
            <>
              <span className="font-bold text-white">
                {nameOf(round.needleControllerId)}
              </span>{" "}
              has the dial.
            </>
          )}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {!iHoldTheDial && (
            <button
              type="button"
              onClick={props.onClaimDial}
              disabled={busy}
              className="rounded-xl border border-white/20 px-6 py-3 font-bold text-white hover:bg-white/10 disabled:opacity-40"
            >
              Let me take it
            </button>
          )}
          {iHoldTheDial && (
            <button
              type="button"
              onClick={props.onLock}
              disabled={busy}
              className="rounded-xl bg-white px-8 py-3 text-lg font-bold text-stone-900 disabled:opacity-40"
            >
              Lock it in
            </button>
          )}
        </div>
      </Panel>
    );
  }

  // ---- opponents call left or right --------------------------------------
  if (round.phase === "prediction") {
    if (iAmActive) {
      return (
        <Waiting>
          Locked in. The other team is deciding whether the target is left or
          right of your needle.
        </Waiting>
      );
    }
    return (
      <Panel>
        <p className="text-lg text-stone-300">
          Is the centre of the target left or right of that needle?
        </p>
        <div className="mt-4 flex justify-center gap-3">
          {(["left", "right"] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => props.onPredict(side)}
              disabled={busy}
              className="min-w-32 rounded-xl border-2 border-white/20 bg-white/5 px-8 py-4 text-xl font-bold uppercase text-white transition-colors hover:border-white/60 hover:bg-white/10 disabled:opacity-40"
            >
              {side}
            </button>
          ))}
        </div>
      </Panel>
    );
  }

  return <Waiting>Starting the next round…</Waiting>;
}
