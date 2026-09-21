"use client";

import {
  MIN_PLAYERS_FOR_COOP,
  MIN_PLAYERS_PER_TEAM_TO_START,
} from "@/lib/game/constants";
import type { RoomStateDto } from "@/lib/server/roomState";

const TEAM_STYLE = {
  teamA: { border: "border-sky-500/40", chip: "bg-sky-500", label: "Team A" },
  teamB: { border: "border-amber-500/40", chip: "bg-amber-500", label: "Team B" },
} as const;

export function Lobby({
  state,
  online,
  onSwitchTeam,
  onStart,
  onLeave,
  onSplitTeams,
  busy,
  error,
}: {
  state: RoomStateDto;
  online: ReadonlySet<string>;
  onSwitchTeam: (team: "a" | "b") => void;
  onStart: () => void;
  onLeave: () => void;
  onSplitTeams: () => void;
  busy: boolean;
  error: string | null;
}) {
  const counts = {
    teamA: state.players.filter((p) => p.team === "teamA").length,
    teamB: state.players.filter((p) => p.team === "teamB").length,
  };
  const total = counts.teamA + counts.teamB;

  // Two playable shapes: two teams that can each field a Psychic and a
  // guesser, or everyone on one side playing co-op. A team of one is the only
  // arrangement that cannot work — that player would be Psychic and sole
  // guesser, moving the needle while looking at the target.
  const versus =
    counts.teamA >= MIN_PLAYERS_PER_TEAM_TO_START &&
    counts.teamB >= MIN_PLAYERS_PER_TEAM_TO_START;
  const coop =
    (counts.teamA >= MIN_PLAYERS_FOR_COOP && counts.teamB === 0) ||
    (counts.teamB >= MIN_PLAYERS_FOR_COOP && counts.teamA === 0);
  const canStart = versus || coop;
  const canSplit = total >= 2 * MIN_PLAYERS_PER_TEAM_TO_START;

  const explanation = versus
    ? "Two teams. You'll guess your own Psychic's clues, and call left or right on theirs."
    : coop
      ? `Co-op — all ${total} of you on one side. One gives the clue, the rest move the needle. No left or right call.`
      : total < MIN_PLAYERS_FOR_COOP
        ? `Waiting for ${MIN_PLAYERS_FOR_COOP - total} more player${MIN_PLAYERS_FOR_COOP - total === 1 ? "" : "s"}…`
        : "A team of one can't play — that person would be the Psychic and the only guesser. Put everyone together for co-op, or two on each side.";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-stone-500">Room code</p>
        <p className="mt-1 font-mono text-5xl tracking-[0.3em] text-white">
          {state.room.code}
        </p>
        <p className="mt-2 text-sm text-stone-500">
          Share it, or send this page&apos;s link.
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {(["teamA", "teamB"] as const).map((teamId) => {
          const style = TEAM_STYLE[teamId];
          const members = state.players.filter((p) => p.team === teamId);
          const isMine = state.me.team === teamId;

          return (
            <section
              key={teamId}
              className={`rounded-xl border bg-white/5 p-4 ${isMine ? style.border : "border-white/10"}`}
            >
              <header className="flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${style.chip}`} />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-200">
                  {style.label}
                </h2>
                <span className="ml-auto text-sm text-stone-500">{members.length}</span>
              </header>

              <ul className="mt-3 space-y-1.5">
                {members.map((player) => (
                  <li key={player.id} className="flex items-center gap-2 text-stone-200">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        online.has(player.id) ? "bg-emerald-400" : "bg-stone-600"
                      }`}
                      title={online.has(player.id) ? "Connected" : "Away"}
                    />
                    <span className="truncate">{player.displayName}</span>
                    {player.isHost && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone-400">
                        Host
                      </span>
                    )}
                    {player.id === state.me.playerId && (
                      <span className="shrink-0 text-xs text-stone-500">you</span>
                    )}
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="text-sm text-stone-600">Nobody yet</li>
                )}
              </ul>

              {!isMine && (
                <button
                  type="button"
                  onClick={() => onSwitchTeam(teamId === "teamA" ? "a" : "b")}
                  className="mt-4 w-full rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10"
                >
                  Switch to {style.label}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <p
        className={`mt-5 text-center text-sm ${canStart ? "text-stone-400" : "text-amber-300/80"}`}
        aria-live="polite"
      >
        {explanation}
      </p>

      {state.me.isHost ? (
        <>
          {canSplit && counts.teamB === 0 && (
            <button
              type="button"
              onClick={onSplitTeams}
              className="mt-4 w-full rounded-xl border border-white/20 px-6 py-3 font-semibold text-stone-200 hover:bg-white/10"
            >
              Split into two teams
            </button>
          )}
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart || busy}
            className="mt-3 w-full rounded-xl bg-white px-6 py-4 text-lg font-bold text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Starting…" : coop ? "Start co-op game" : "Start game"}
          </button>
        </>
      ) : (
        <p className="mt-6 text-center text-stone-400">
          Waiting for the host to start…
        </p>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-center text-sm text-rose-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onLeave}
        className="mx-auto mt-6 block text-sm text-stone-500 underline underline-offset-4 hover:text-stone-300"
      >
        Leave this room
      </button>
    </div>
  );
}
