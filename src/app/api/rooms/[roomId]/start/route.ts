import { MIN_PLAYERS_FOR_FREE_FOR_ALL } from "@/lib/game/constants";
import { createRound } from "@/lib/server/createRound";
import { notifyRoom } from "@/lib/server/broadcast";
import { all, newId, run, transaction } from "@/lib/server/db";
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

    const result = transaction(() => {
      const players = all<{ id: string }>(
        "select id from players where room_id = ? and left_at is null",
        roomId,
      );

      // Two, because the Psychic knows where the target is — somebody else has
      // to be doing the guessing. There are no teams to satisfy beyond that.
      if (players.length < MIN_PLAYERS_FOR_FREE_FOR_ALL) {
        throw new ApiError(
          "CONFLICT",
          `You need at least ${MIN_PLAYERS_FOR_FREE_FOR_ALL} players.`,
        );
      }

      // Conditional on still being in the lobby, so a double-click cannot
      // create two games for one room.
      const started = run(
        "update rooms set status = 'in_game' where id = ? and status = 'lobby'",
        roomId,
      );
      if (started === 0) throw new ApiError("CONFLICT", "The game has already started.");

      // Everyone sits on one side; the round machinery still wants a team.
      const startingTeam = "a" as const;
      const gameId = newId();
      run(
        "insert into games (id, room_id, starting_team) values (?, ?, ?)",
        gameId,
        roomId,
        startingTeam,
      );

      const { roundId } = createRound({
        roomId,
        gameId,
        roundNumber: 1,
        activeTeam: startingTeam,
      });
      return { gameId, roundId };
    });

    notifyRoom(roomId, "game-started");

    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
