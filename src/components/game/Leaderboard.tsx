import { colourFor } from "@/components/dial/GuessMarkers";

export interface LeaderboardRow {
  readonly playerId: string;
  readonly name: string;
  readonly score: number;
  readonly isPsychic: boolean;
  readonly isMe: boolean;
  readonly hasGuessed: boolean;
  readonly roundPoints: number | null;
  readonly colourIndex: number;
}

export function Leaderboard({
  rows,
  target,
  showRoundPoints,
}: {
  rows: readonly LeaderboardRow[];
  target: number;
  showRoundPoints: boolean;
}) {
  // Ranked, but ties keep their join order so the list does not shuffle
  // around between rounds for no reason.
  const ranked = [...rows].sort((a, b) => b.score - a.score);
  const leader = ranked[0]?.score ?? 0;

  return (
    <ul className="flex flex-col gap-1.5" data-testid="leaderboard">
      {ranked.map((row) => (
        <li
          key={row.playerId}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ${
            row.isMe ? "bg-white/10" : "bg-white/[0.03]"
          }`}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colourFor(row.colourIndex) }}
          />
          <span className="min-w-0 flex-1 truncate text-stone-200">
            {row.name}
            {row.isMe && <span className="ml-1.5 text-xs text-stone-500">you</span>}
          </span>

          {row.isPsychic ? (
            <span className="shrink-0 rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-200">
              Psychic
            </span>
          ) : (
            !showRoundPoints &&
            row.hasGuessed && (
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-emerald-300">
                locked in
              </span>
            )
          )}

          {showRoundPoints && row.roundPoints !== null && (
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                row.roundPoints > 0 ? "text-emerald-300" : "text-stone-600"
              }`}
            >
              +{row.roundPoints}
            </span>
          )}

          <span className="w-12 shrink-0 text-right text-lg font-bold tabular-nums text-white">
            {row.score}
          </span>
          <span className="w-8 shrink-0 text-right text-xs text-stone-600">
            /{target}
          </span>
          {row.score === leader && leader > 0 && (
            <span className="sr-only">leading</span>
          )}
        </li>
      ))}
    </ul>
  );
}
