/**
 * Free-for-all scoring: no teams, everyone places their own needle.
 *
 * A departure from the printed rules, which are a team game — kept in its own
 * module so the faithful scoring in `scoring.ts` stays untouched and the two
 * cannot drift into each other.
 */

import { scoreNeedle } from "./scoring";
import type { Position } from "./geometry";
import type { PlayerId, WedgeScore } from "./types";

export interface Guess {
  readonly playerId: PlayerId;
  readonly position: Position;
}

export interface FreeForAllAward {
  readonly playerId: PlayerId;
  readonly points: number;
  /** Null for the Psychic, who did not place a needle. */
  readonly position: Position | null;
  readonly isPsychic: boolean;
}

/**
 * The Psychic scores the average of everyone else's result, rounded to the
 * nearest whole point.
 *
 * This is the whole reason the role is worth having: a clue that lands the
 * room near the target scores well, a vague one scores badly. Without it the
 * Psychic can only lose ground on their own turn.
 */
export function scoreFreeForAllRound(
  targetCenter: Position,
  psychicId: PlayerId,
  guesses: readonly Guess[],
): readonly FreeForAllAward[] {
  const scored = guesses
    .filter((guess) => guess.playerId !== psychicId)
    .map((guess) => ({
      playerId: guess.playerId,
      position: guess.position,
      points: scoreNeedle(targetCenter, guess.position) as WedgeScore,
      isPsychic: false as const,
    }));

  const total = scored.reduce((sum, award) => sum + award.points, 0);
  // No guesses means no signal about the clue, so the Psychic scores nothing
  // rather than being rewarded for a round nobody played.
  const psychicPoints = scored.length === 0 ? 0 : Math.round(total / scored.length);

  return [
    ...scored,
    { playerId: psychicId, points: psychicPoints, position: null, isPsychic: true },
  ];
}

export interface Standing {
  readonly id: PlayerId;
  readonly score: number;
}

/**
 * Who has won, if anyone.
 *
 * Reaching the winning score ends the game at the end of that round, but it
 * does not decide who won: everyone scores every round, so several players can
 * cross the line together, and the highest score among them takes it. Players
 * level on the top score share the win.
 *
 * Empty while nobody has reached the winning score, i.e. the game goes on.
 */
export function freeForAllWinners(
  players: readonly Standing[],
  winningScore: number,
): PlayerId[] {
  const best = Math.max(...players.map((player) => player.score));
  if (players.length === 0 || best < winningScore) return [];
  return players.filter((player) => player.score === best).map((player) => player.id);
}
