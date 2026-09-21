"use client";

import { MIN_PLAYERS_FOR_FREE_FOR_ALL } from "@/lib/game/constants";
import type { RoomStateDto } from "@/lib/server/roomState";
import { colourFor } from "@/components/dial/GuessMarkers";

export function Lobby({
  state,
  online,
  onStart,
  onLeave,
  busy,
  error,
}: {
  state: RoomStateDto;
  online: ReadonlySet<string>;
  onStart: () => void;
  onLeave: () => void;
  busy: boolean;
  error: string | null;
}) {
  const players = state.players;
  // Two, because the Psychic knows where the target is — somebody else has
  // to be doing the guessing.
  const canStart = players.length >= MIN_PLAYERS_FOR_FREE_FOR_ALL;
  const needed = MIN_PLAYERS_FOR_FREE_FOR_ALL - players.length;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-stone-500">Room code</p>
        <p className="mt-1 font-mono text-5xl tracking-[0.3em] text-white">
          {state.room.code}
        </p>
        <p className="mt-2 text-sm text-stone-500">
          Share it, or send this page&apos;s link.
        </p>
      </div>

      <ul className="mt-8 flex flex-col gap-1.5">
        {players.map((player, index) => (
          <li
            key={player.id}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 ${
              player.id === state.me.playerId ? "bg-white/10" : "bg-white/[0.03]"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colourFor(index) }}
            />
            <span className="min-w-0 flex-1 truncate text-stone-200">
              {player.displayName}
            </span>
            {player.isHost && (
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone-400">
                Host
              </span>
            )}
            {player.id === state.me.playerId && (
              <span className="shrink-0 text-xs text-stone-500">you</span>
            )}
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                online.has(player.id) ? "bg-emerald-400" : "bg-stone-600"
              }`}
              title={online.has(player.id) ? "Connected" : "Away"}
            />
          </li>
        ))}
      </ul>

      <p className="mt-5 text-center text-sm text-stone-400" aria-live="polite">
        {canStart
          ? `${players.length} playing. Each round one of you gives a clue and everyone else guesses on their own dial.`
          : `Waiting for ${needed} more player${needed === 1 ? "" : "s"}…`}
      </p>

      {state.me.isHost ? (
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart || busy}
          className="mt-4 w-full rounded-xl bg-white px-6 py-4 text-lg font-bold text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Starting…" : "Start game"}
        </button>
      ) : (
        <p className="mt-4 text-center text-stone-400">
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
