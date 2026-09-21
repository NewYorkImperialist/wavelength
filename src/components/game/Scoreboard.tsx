import { WINNING_SCORE } from "@/lib/game/constants";
import type { GameState, TeamId } from "@/lib/game/types";

const TEAM_STYLE: Record<TeamId, { chip: string; bar: string; text: string }> = {
  teamA: { chip: "bg-sky-500", bar: "bg-sky-500", text: "text-sky-300" },
  teamB: { chip: "bg-amber-500", bar: "bg-amber-500", text: "text-amber-300" },
};

export function Scoreboard({ state }: { state: GameState }) {
  const target = state.config.winningScore || WINNING_SCORE;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="scoreboard">
      {(["teamA", "teamB"] as const).map((teamId) => {
        const team = state.teams[teamId];
        const isActive = state.activeTeam === teamId && state.phase !== "lobby";
        const style = TEAM_STYLE[teamId];

        return (
          <div
            key={teamId}
            data-testid={`score-${teamId}`}
            className={`rounded-xl border p-3 sm:p-4 transition-colors ${
              isActive
                ? "border-white/40 bg-white/10"
                : "border-white/10 bg-white/5"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-3 w-3 shrink-0 rounded-full ${style.chip}`} />
                <span className="truncate text-sm font-semibold uppercase tracking-wide text-stone-200">
                  {team.name}
                </span>
              </div>
              <span className={`text-2xl font-bold tabular-nums sm:text-3xl ${style.text}`}>
                {team.score}
              </span>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-500 ${style.bar}`}
                style={{ width: `${Math.min(100, (team.score / target) * 100)}%` }}
              />
            </div>

            <p className="mt-2 h-4 text-xs text-stone-400">
              {isActive ? "Their turn" : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
