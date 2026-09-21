import type { RoundResult, TeamId } from "@/lib/game/types";

const TEAM_TEXT: Record<TeamId, string> = {
  teamA: "text-sky-300",
  teamB: "text-amber-300",
};

const OPPONENT: Record<TeamId, TeamId> = { teamA: "teamB", teamB: "teamA" };

export function RoundResultPanel({
  result,
  teamNames,
}: {
  result: RoundResult;
  teamNames: Readonly<Record<TeamId, string>>;
}) {
  const opposing = OPPONENT[result.activeTeam];
  const calledCorrectly = result.opposingTeamPoints > 0;
  const blockedByBullseye = result.activeTeamPoints === 4;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      data-testid="round-result"
      aria-live="polite"
    >
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className={`text-sm font-semibold uppercase tracking-wide ${TEAM_TEXT[result.activeTeam]}`}>
          {teamNames[result.activeTeam]}
        </p>
        <p className="mt-1 text-4xl font-bold tabular-nums text-white">
          +{result.activeTeamPoints}
        </p>
        <p className="mt-1 text-sm text-stone-400">
          {result.activeTeamPoints === 0
            ? "Missed the target"
            : result.activeTeamPoints === 4
              ? "Dead centre"
              : `Landed in the ${result.activeTeamPoints}-point band`}
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className={`text-sm font-semibold uppercase tracking-wide ${TEAM_TEXT[opposing]}`}>
          {teamNames[opposing]}
        </p>
        <p className="mt-1 text-4xl font-bold tabular-nums text-white">
          +{result.opposingTeamPoints}
        </p>
        <p className="mt-1 text-sm text-stone-400">
          {result.prediction === null
            ? "No call made"
            : blockedByBullseye
              ? `Called ${result.prediction} — but a bullseye blocks the bonus`
              : calledCorrectly
                ? `Correctly called ${result.prediction}`
                : `Called ${result.prediction} — wrong side`}
        </p>
      </div>
    </div>
  );
}
