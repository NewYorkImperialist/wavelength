/** Domain types for a Wavelength room. */

import type { Position } from "./geometry";

export type TeamId = "teamA" | "teamB";
export type PlayerId = string;
export type Side = "left" | "right";

export type WedgeScore = 0 | 2 | 3 | 4;
export type BonusScore = 0 | 1;

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly team: TeamId;
  readonly connected: boolean;
  readonly joinedAt: number;
}

export interface Team {
  readonly id: TeamId;
  readonly name: string;
  readonly score: number;
  /**
   * Psychic rotation order. Append-only: players who leave are marked
   * disconnected but keep their slot, so rejoining never causes a repeat or a
   * skip in the cycle.
   */
  readonly rotation: readonly PlayerId[];
  /** Index in `rotation` of the most recent psychic; -1 before the first round. */
  readonly psychicCursor: number;
}

export type GamePhase =
  | "lobby"
  | "clue"
  | "guess"
  | "prediction"
  | "reveal"
  | "gameOver";

export interface RoundResult {
  readonly roundNumber: number;
  readonly activeTeam: TeamId;
  readonly psychicId: PlayerId;
  readonly cardId: string;
  readonly clue: string;
  readonly targetCenter: Position;
  readonly needlePosition: Position;
  readonly prediction: Side | null;
  readonly activeTeamPoints: WedgeScore;
  readonly opposingTeamPoints: BonusScore;
  readonly scoresAfter: Readonly<Record<TeamId, number>>;
}

export interface PublicRoundState {
  readonly roundNumber: number;
  readonly cardId: string;
  readonly psychicId: PlayerId;
  readonly controllerId: PlayerId;
  readonly clue: string | null;
  readonly needlePosition: Position;
  readonly needleLocked: boolean;
  readonly prediction: Side | null;
  /** Null until the reveal action lands. Never populated early. */
  readonly revealedTarget: Position | null;
  readonly result: RoundResult | null;
}

/** Server-side and psychic-only. Never merged into `GameState`. */
export interface SecretRoundState {
  readonly targetCenter: Position;
}

export interface SuddenDeathState {
  /** 1 for the first sudden-death round, incrementing while ties persist. */
  readonly index: number;
  readonly turnsTaken: 0 | 1 | 2;
  /** The tiebreak tally for this sudden-death round only. */
  readonly pointsThisRound: Readonly<Record<TeamId, number>>;
}

export interface GameConfig {
  readonly winningScore: number;
  readonly minPlayersPerTeamToStart: number;
}

export interface GameState {
  /** Increments on every successful transition; unchanged on a rejected one. */
  readonly version: number;
  readonly phase: GamePhase;
  readonly hostId: PlayerId;
  readonly players: Readonly<Record<PlayerId, Player>>;
  readonly teams: Readonly<Record<TeamId, Team>>;
  readonly activeTeam: TeamId;
  readonly roundNumber: number;
  readonly round: PublicRoundState | null;
  /** Non-null *is* the sudden-death flag. Never a boolean. */
  readonly suddenDeath: SuddenDeathState | null;
  readonly usedCardIds: readonly string[];
  readonly history: readonly RoundResult[];
  readonly winner: TeamId | null;
  readonly config: GameConfig;
}

export interface RoomState {
  readonly public: GameState;
  /** Populated on the server, and on the psychic's client. Null elsewhere. */
  readonly secret: SecretRoundState | null;
}
