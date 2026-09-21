import "server-only";

import { serviceClient } from "./db";
import { ApiError } from "./errors";
import { toPublicRound, teamIdOf, type PublicRoundDto, type RoundRowFull } from "./mappers";
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
  /** True when everyone is on one side: no opposing team, no left/right call. */
  readonly cooperative: boolean;
  readonly serverTimeMs: number;
}

export async function loadRoomState(actor: Actor): Promise<RoomStateDto> {
  const db = serviceClient();

  const { data: room, error: roomError } = await db
    .from("rooms")
    .select("id, code, status, winning_score, host_player_id")
    .eq("id", actor.roomId)
    .maybeSingle<{
      id: string;
      code: string;
      status: "lobby" | "in_game" | "finished";
      winning_score: number;
      host_player_id: string | null;
    }>();

  if (roomError !== null) throw new ApiError("SERVER_ERROR", "Could not load the room.");
  if (room === null) throw new ApiError("NOT_FOUND", "No such room.");

  const { data: playerRows } = await db
    .from("players")
    .select("id, display_name, team, seat_order, is_host")
    .eq("room_id", actor.roomId)
    .is("left_at", null)
    .order("seat_order", { ascending: true })
    .returns<
      { id: string; display_name: string; team: "a" | "b" | null; seat_order: number; is_host: boolean }[]
    >();

  const { data: game } = await db
    .from("games")
    .select("id, score_a, score_b, winner, status, sudden_death_index, current_round_id")
    .eq("room_id", actor.roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      score_a: number;
      score_b: number;
      winner: "a" | "b" | null;
      status: string;
      sudden_death_index: number;
      current_round_id: string | null;
    }>();

  let round: PublicRoundDto | null = null;
  if (game?.current_round_id != null) {
    const { data: roundRow } = await db
      .from("rounds")
      .select(
        "id, round_number, active_team, psychic_player_id, phase, card_id, clue, needle_controller_id, needle_position, prediction, revealed_target, active_points, opponent_points, target_commitment",
      )
      .eq("id", game.current_round_id)
      .maybeSingle<RoundRowFull>();

    if (roundRow !== null && roundRow !== undefined) {
      const { data: card } = await db
        .from("spectrum_cards")
        .select("id, left_label, right_label")
        .eq("id", roundRow.card_id)
        .maybeSingle<{ id: string; left_label: string; right_label: string }>();

      round = toPublicRound(
        roundRow,
        card ?? { id: roundRow.card_id, left_label: "", right_label: "" },
      );
    }
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
    players: (playerRows ?? []).map((p) => ({
      id: p.id,
      displayName: p.display_name,
      team: p.team === null ? null : teamIdOf(p.team),
      seatOrder: p.seat_order,
      isHost: p.is_host,
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
    cooperative:
      (playerRows ?? []).filter((p) => p.team === "a").length === 0 ||
      (playerRows ?? []).filter((p) => p.team === "b").length === 0,
    // Lets clients run timers without trusting their own clock.
    serverTimeMs: Date.now(),
  };
}
