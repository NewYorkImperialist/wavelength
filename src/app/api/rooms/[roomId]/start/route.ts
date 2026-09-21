import { MIN_PLAYERS_FOR_FREE_FOR_ALL } from "@/lib/game/constants";
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
      .select("id")
      .eq("room_id", roomId)
      .is("left_at", null)
      .returns<{ id: string }[]>();

    // Two, because the Psychic knows where the target is — somebody else has
    // to be doing the guessing. There are no teams to satisfy beyond that.
    if ((players ?? []).length < MIN_PLAYERS_FOR_FREE_FOR_ALL) {
      throw new ApiError(
        "CONFLICT",
        `You need at least ${MIN_PLAYERS_FOR_FREE_FOR_ALL} players.`,
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

    // Everyone sits on one side; the round machinery still wants a team.
    const startingTeam = "a" as const;
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
