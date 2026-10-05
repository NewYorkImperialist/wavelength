import "server-only";

import { tallySkipVotes } from "@/lib/game/vote-skip";

import { all, one } from "./db";
import { ApiError } from "./errors";
import {
  stepsToPosition,
  teamIdOf,
  toPublicRound,
  type PublicRoundDto,
  type RoundRowFull,
} from "./mappers";
import type { Actor } from "./session";

/**
 * The single bootstrap payload.
 *
 * Everything a client needs to render the correct screen after a page load or
 * a reconnect comes from here, so there is one place to audit for leaks rather
 * than a dozen ad-hoc queries. The round goes through `toPublicRound`, which
 * allow-lists fields — adding a column to `rounds` cannot silently publish it.
 */

export interface RoomStateDto {
  readonly room: {
    id: string;
    code: string;
    status: "lobby" | "in_game" | "finished";
    winningScore: number;
    hostPlayerId: string | null;
  };
  readonly me: {
    playerId: string;
    team: "teamA" | "teamB" | null;
    isHost: boolean;
    isPsychic: boolean;
  };
  readonly players: ReadonlyArray<{
    id: string;
    displayName: string;
    team: "teamA" | "teamB" | null;
    seatOrder: number;
    isHost: boolean;
    score: number;
  }>;
  /**
   * Committed guesses for the current round. `points` is null until the
   * reveal. Guesses are not secret — seeing where everyone landed is the
   * whole payoff — and the target itself lives elsewhere entirely.
   */
  readonly guesses: ReadonlyArray<{
    playerId: string;
    position: number;
    points: number | null;
  }>;
  readonly game: null | {
    id: string;
    scoreA: number;
    scoreB: number;
    winner: "teamA" | "teamB" | null;
    status: string;
    suddenDeathIndex: number;
  };
  readonly round: PublicRoundDto | null;
  /**
   * Who currently wants the card thrown away, and how many votes that would
   * take. Not secret: watching the tally move is what makes this a vote
   * rather than a silent host power.
   */
  readonly skipVotes: {
    readonly voterIds: readonly string[];
    readonly required: number;
  };
  /** True when everyone is on one side: no opposing team, no left/right call. */
  readonly cooperative: boolean;
  readonly serverTimeMs: number;
}

export async function loadRoomState(actor: Actor): Promise<RoomStateDto> {
  const room = one<{
    id: string;
    code: string;
    status: "lobby" | "in_game" | "finished";
    winning_score: number;
    host_player_id: string | null;
  }>(
    "select id, code, status, winning_score, host_player_id from rooms where id = ?",
    actor.roomId,
  );
  if (room === null) throw new ApiError("NOT_FOUND", "No such room.");

  const playerRows = all<{
    id: string;
    display_name: string;
    team: "a" | "b" | null;
    seat_order: number;
    is_host: number;
    score: number;
  }>(
    `select id, display_name, team, seat_order, is_host, score
       from players where room_id = ? and left_at is null
      order by seat_order`,
    actor.roomId,
  );

  const game = one<{
    id: string;
    score_a: number;
    score_b: number;
    winner: "a" | "b" | null;
    status: string;
    sudden_death_index: number;
    current_round_id: string | null;
  }>(
    `select id, score_a, score_b, winner, status, sudden_death_index, current_round_id
       from games where room_id = ?
      order by rowid desc limit 1`,
    actor.roomId,
  );

  let round: PublicRoundDto | null = null;
  let guesses: RoomStateDto["guesses"] = [];
  let skipVotes: RoomStateDto["skipVotes"] = { voterIds: [], required: 0 };
  const roundRow =
    game?.current_round_id == null
      ? null
      : one<RoundRowFull>(
          `select id, round_number, active_team, psychic_player_id, phase, card_id, clue,
                  needle_controller_id, needle_position, prediction, revealed_target,
                  active_points, opponent_points, target_commitment
             from rounds where id = ?`,
          game.current_round_id,
        );

  if (roundRow !== null) {
    const card = one<{ id: string; left_label: string; right_label: string }>(
      "select id, left_label, right_label from spectrum_cards where id = ?",
      roundRow.card_id,
    );
    round = toPublicRound(
      roundRow,
      card ?? { id: roundRow.card_id, left_label: "", right_label: "" },
    );

    guesses = all<{ player_id: string; position: number; points: number | null }>(
      "select player_id, position, points from round_guesses where round_id = ?",
      roundRow.id,
    ).map((row) => ({
      playerId: row.player_id,
      // Before the reveal, publish only WHO has locked in — not where.
      // Otherwise a late guesser could read everyone else's answer and
      // simply average it.
      position: roundRow.revealed_target === null ? -1 : stepsToPosition(row.position),
      points: row.points,
    }));

    const voteRows = all<{ player_id: string; card_id: string }>(
      "select player_id, card_id from round_skip_votes where round_id = ?",
      roundRow.id,
    );

    // Tallied through the engine rather than counted here, so the rules
    // about stale and departed votes have one implementation.
    const tally = tallySkipVotes(
      playerRows.map((player) => player.id),
      voteRows.map((row) => ({ playerId: row.player_id, cardId: row.card_id })),
      roundRow.card_id,
    );
    skipVotes = { voterIds: tally.voterIds, required: tally.required };
  }

  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      winningScore: room.winning_score,
      hostPlayerId: room.host_player_id,
    },
    me: {
      playerId: actor.playerId,
      team: actor.team === null ? null : teamIdOf(actor.team),
      isHost: actor.isHost,
      // Told explicitly, so the client never has to infer entitlement to the
      // target from anything it could tamper with.
      isPsychic: round?.psychicPlayerId === actor.playerId,
    },
    players: playerRows.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      team: p.team === null ? null : teamIdOf(p.team),
      seatOrder: p.seat_order,
      isHost: p.is_host === 1,
      score: p.score,
    })),
    game:
      game == null
        ? null
        : {
            id: game.id,
            scoreA: game.score_a,
            scoreB: game.score_b,
            winner: game.winner === null ? null : teamIdOf(game.winner),
            status: game.status,
            suddenDeathIndex: game.sudden_death_index,
          },
    round,
    guesses,
    skipVotes,
    cooperative:
      playerRows.filter((p) => p.team === "a").length === 0 ||
      playerRows.filter((p) => p.team === "b").length === 0,
    // Lets clients run timers without trusting their own clock.
    serverTimeMs: Date.now(),
  };
}
