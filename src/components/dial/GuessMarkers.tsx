import { RADII } from "@/lib/game/constants";
import { needleLine, pointAtPosition, type Position } from "@/lib/game/geometry";

export interface GuessMarker {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly points: number | null;
  readonly isMe: boolean;
}

/** Enough colours that a full room stays distinguishable. */
const COLOURS = [
  "#38bdf8", "#fbbf24", "#a78bfa", "#34d399",
  "#fb7185", "#f97316", "#22d3ee", "#c084fc",
] as const;

const colourFor = (index: number): string => COLOURS[index % COLOURS.length]!;

/**
 * Everyone's committed needle, drawn together at the reveal.
 *
 * This is the moment the game is for — seeing how far apart people read the
 * same clue. Each marker is labelled with a name and what it scored, so the
 * argument afterwards has something to point at.
 */
export function GuessMarkers({ guesses }: { guesses: readonly GuessMarker[] }) {
  return (
    <g data-testid="guess-markers">
      {guesses.map((guess, index) => {
        const { tip } = needleLine(guess.position);
        const pivotEnd = pointAtPosition(guess.position, RADII.hub);
        const label = pointAtPosition(guess.position, RADII.needleTip + 26);
        const colour = colourFor(index);

        return (
          <g key={guess.playerId} data-testid={`guess-${guess.playerId}`}>
            <line
              x1={pivotEnd.x}
              y1={pivotEnd.y}
              x2={tip.x}
              y2={tip.y}
              stroke={colour}
              strokeWidth={guess.isMe ? 6 : 4}
              strokeLinecap="round"
              opacity={guess.isMe ? 1 : 0.85}
            />
            <circle cx={tip.x} cy={tip.y} r={guess.isMe ? 9 : 7} fill={colour} />
            <text
              x={label.x}
              y={label.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill={colour}
              fontSize={26}
              className="font-semibold"
            >
              {guess.name}
              {guess.points === null ? "" : ` ${guess.points}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export { colourFor };
