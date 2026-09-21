"use client";

import { useState } from "react";

import { MIN_PLAYERS_PER_TEAM_TO_START } from "@/lib/game/constants";
import type { LocalPlayerSeed } from "@/lib/local/useLocalGame";
import type { TeamId } from "@/lib/game/types";

const DEFAULTS: LocalPlayerSeed[] = [
  { name: "Ada", team: "teamA" },
  { name: "Alan", team: "teamA" },
  { name: "Bo", team: "teamB" },
  { name: "Bea", team: "teamB" },
];

export function LocalSetup({ onStart }: { onStart: (players: LocalPlayerSeed[]) => void }) {
  const [players, setPlayers] = useState<LocalPlayerSeed[]>(DEFAULTS);

  const counts: Record<TeamId, number> = {
    teamA: players.filter((p) => p.team === "teamA").length,
    teamB: players.filter((p) => p.team === "teamB").length,
  };
  const canStart =
    counts.teamA >= MIN_PLAYERS_PER_TEAM_TO_START &&
    counts.teamB >= MIN_PLAYERS_PER_TEAM_TO_START &&
    players.every((p) => p.name.trim().length > 0);

  const update = (index: number, patch: Partial<LocalPlayerSeed>) => {
    setPlayers((current) =>
      current.map((player, i) => (i === index ? { ...player, ...patch } : player)),
    );
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <h1 className="text-3xl font-bold text-white">Pass-the-device game</h1>
      <p className="mt-2 text-stone-400">
        Everyone plays from this one screen. You&apos;ll be told when to hand it over.
      </p>

      <ul className="mt-6 space-y-2">
        {players.map((player, index) => (
          <li key={index} className="flex gap-2">
            <input
              value={player.name}
              onChange={(e) => update(index, { name: e.target.value })}
              aria-label={`Player ${index + 1} name`}
              placeholder="Name"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white placeholder:text-stone-500 focus:border-white/40 focus:outline-none"
            />
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/15">
              {(["teamA", "teamB"] as const).map((team) => (
                <button
                  key={team}
                  type="button"
                  onClick={() => update(index, { team })}
                  aria-pressed={player.team === team}
                  className={`px-3 py-2 text-sm font-semibold transition-colors ${
                    player.team === team
                      ? team === "teamA"
                        ? "bg-sky-500 text-white"
                        : "bg-amber-500 text-stone-900"
                      : "bg-transparent text-stone-400 hover:text-white"
                  }`}
                >
                  {team === "teamA" ? "A" : "B"}
                </button>
              ))}
            </div>
            {players.length > 4 && (
              <button
                type="button"
                onClick={() => setPlayers((c) => c.filter((_, i) => i !== index))}
                aria-label={`Remove player ${index + 1}`}
                className="shrink-0 rounded-lg border border-white/15 px-3 text-stone-400 hover:text-white"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() =>
          setPlayers((c) => [
            ...c,
            { name: "", team: counts.teamA <= counts.teamB ? "teamA" : "teamB" },
          ])
        }
        className="mt-3 text-sm text-stone-400 underline underline-offset-4 hover:text-white"
      >
        Add a player
      </button>

      <button
        type="button"
        disabled={!canStart}
        onClick={() => onStart(players.map((p) => ({ ...p, name: p.name.trim() })))}
        className="mt-6 w-full rounded-xl bg-white px-6 py-3 text-lg font-bold text-stone-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Start game
      </button>
      {!canStart && (
        <p className="mt-2 text-center text-sm text-stone-500">
          Each team needs at least {MIN_PLAYERS_PER_TEAM_TO_START} players with names.
        </p>
      )}
    </div>
  );
}
