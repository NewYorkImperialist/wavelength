import {
  MIN_PLAYERS_FOR_COOP,
  MIN_PLAYERS_PER_TEAM_TO_START,
} from "@/lib/game/constants";
import { createRound } from "@/lib/server/createRound";
import { notifyRoom } from "@/lib/server/broadcast";
import { serviceClient } from "@/lib/server/db";
import { ApiError, handleRoute } from "@/lib/server/errors";
import { assertHost } from "@/lib/server/guards";
import { requireActor } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Host starts the game: creates the game row and the first round. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { roomId } = await context.params;
    const actor = await requireActor(roomId);
    assertHost(actor);

    const db = serviceClient();

    const { data: players } = await db
      .from("players")
      .select("team")
      .eq("room_id", roomId)
      .is("left_at", null)
      .returns<{ team: "a" | "b" | null }[]>();

    const counts = { a: 0, b: 0 };
    for (const player of players ?? []) {
      if (player.team === "a") counts.a++;
      if (player.team === "b") counts.b++;
    }

    // Two valid shapes. Either both teams can field a Psychic and a guesser,
    // or everyone is on one side and plays co-op. What is never valid is a
    // team of one: that player would be Psychic and sole guesser, moving the
    // needle while looking at the target.
    const versus =
      counts.a >= MIN_PLAYERS_PER_TEAM_TO_START && counts.b >= MIN_PLAYERS_PER_TEAM_TO_START;
    const coop =
      (counts.a >= MIN_PLAYERS_FOR_COOP && counts.b === 0) ||
      (counts.b >= MIN_PLAYERS_FOR_COOP && counts.a === 0);

    if (!versus && !coop) {
      throw new ApiError(
        "CONFLICT",
        counts.a + counts.b < MIN_PLAYERS_FOR_COOP
          ? `You need at least ${MIN_PLAYERS_FOR_COOP} players.`
          : "Put everyone on one team to play co-op, or at least two on each side.",
      );
    }

    // Conditional on still being in the lobby, so a double-click cannot create
    // two games for one room.
    const { data: room, error: roomError } = await db
      .from("rooms")
      .update({ status: "in_game" })
      .eq("id", roomId)
      .eq("status", "lobby")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (roomError !== null) throw new ApiError("SERVER_ERROR", "Could not start the game.");
    if (room === null) throw new ApiError("CONFLICT", "The game has already started.");

    const startingTeam: "a" | "b" =
      counts.b === 0 ? "a" : counts.a === 0 ? "b" : Math.random() < 0.5 ? "a" : "b";
    const { data: game, error: gameError } = await db
      .from("games")
      .insert({ room_id: roomId, starting_team: startingTeam })
      .select("id")
      .single<{ id: string }>();

    if (gameError !== null || game === null) {
      throw new ApiError("SERVER_ERROR", "Could not create the game.");
    }

    const { roundId } = await createRound({
      roomId,
      gameId: game.id,
      roundNumber: 1,
      activeTeam: startingTeam,
    });

    notifyRoom(roomId, "game-started");

    return Response.json(
      { gameId: game.id, roundId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
