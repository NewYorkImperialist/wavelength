/**
 * The SQLite layer, against a real (in-memory) database.
 *
 * What these pin down are the guarantees the old Postgres code fenced with
 * conditional updates and SECURITY DEFINER functions: the target never lands
 * in `rounds`, a reveal scores exactly once, and a reroll moves the card, the
 * target and the commitment together or not at all.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { SPECTRUM_DECK } from "@/lib/game/deck";

import { commitToTarget, createRound } from "../createRound";
import { all, newId, one, run } from "../db";
import { revealFreeForAll } from "../freeForAll";
import { createRoom, joinRoom } from "../rooms";
import { rerollCard } from "../skipVote";

beforeEach(() => {
  // A fresh database per test: `database()` reopens when the path changes.
  process.env.DATABASE_PATH = ":memory:";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("wavelength.database")];
});

async function roomWithGame(players: string[]) {
  const host = await createRoom(players[0]);
  const joined = [];
  for (const name of players.slice(1)) joined.push(await joinRoom(host.code, name));
  const gameId = newId();
  run("update rooms set status = 'in_game' where id = ?", host.roomId);
  run("insert into games (id, room_id, starting_team) values (?, ?, 'a')", gameId, host.roomId);
  const { roundId } = createRound({ roomId: host.roomId, gameId, roundNumber: 1, activeTeam: "a" });
  return { host, joined, gameId, roundId };
}

describe("schema", () => {
  it("syncs the whole deck in", () => {
    const cards = all<{ id: string }>("select id from spectrum_cards where enabled = 1");
    expect(cards).toHaveLength(SPECTRUM_DECK.length);
  });

  it("refuses a malformed room code", () => {
    expect(() => run("insert into rooms (id, code) values (?, 'ABC10I')", newId())).toThrow(
      /CHECK constraint/,
    );
  });
});

describe("rooms", () => {
  it("makes the creator host, seated first", async () => {
    const room = await createRoom("  Ada   Lovelace ");
    const player = one<{ display_name: string; is_host: number; seat_order: number }>(
      "select display_name, is_host, seat_order from players where id = ?",
      room.playerId,
    );
    expect(player).toEqual({ display_name: "Ada Lovelace", is_host: 1, seat_order: 0 });
    expect(one("select host_player_id from rooms where id = ?", room.roomId)).toEqual({
      host_player_id: room.playerId,
    });
  });

  it("stores only a hash of the session token", async () => {
    const room = await createRoom("Ada");
    const session = one<{ token_hash: Uint8Array }>(
      "select token_hash from player_sessions where player_id = ?",
      room.playerId,
    );
    const expected = createHash("sha256").update(room.token).digest();
    expect(Buffer.from(session!.token_hash).equals(expected)).toBe(true);
  });

  it("stops at twelve players", async () => {
    const room = await createRoom("P0");
    for (let i = 1; i < 12; i++) await joinRoom(room.code, `P${i}`);
    await expect(joinRoom(room.code, "P12")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses joins once the game has started", async () => {
    const { host } = await roomWithGame(["Ada", "Bo"]);
    await expect(joinRoom(host.code, "Late")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("rounds", () => {
  it("keeps the target out of the rounds row, behind a matching commitment", async () => {
    const { roundId } = await roomWithGame(["Ada", "Bo"]);

    const round = one<Record<string, unknown>>("select * from rounds where id = ?", roundId)!;
    expect(round.revealed_target).toBeNull();

    const secret = one<{ target_center: number; nonce: Uint8Array }>(
      "select target_center, nonce from round_targets where round_id = ?",
      roundId,
    )!;
    for (const value of Object.values(round)) expect(value).not.toBe(secret.target_center);

    const { commitment } = commitToTarget(secret.target_center, Buffer.from(secret.nonce));
    expect(Buffer.from(round.target_commitment as Uint8Array).equals(commitment)).toBe(true);
  });

  it("reveals and scores exactly once", async () => {
    const { host, joined, roundId } = await roomWithGame(["Ada", "Bo", "Cy"]);
    const psychicId = one<{ psychic_player_id: string }>(
      "select psychic_player_id from rounds where id = ?",
      roundId,
    )!.psychic_player_id;
    const target = one<{ target_center: number }>(
      "select target_center from round_targets where round_id = ?",
      roundId,
    )!.target_center;

    run("update rounds set clue = 'x', phase = 'guess' where id = ?", roundId);
    // Every guesser dead on the target: 4 each, and the Psychic takes the average.
    for (const player of [host, ...joined]) {
      if (player.playerId === psychicId) continue;
      run(
        "insert into round_guesses (round_id, player_id, position) values (?, ?, ?)",
        roundId,
        player.playerId,
        target,
      );
    }

    const input = { roundId, roomId: host.roomId, psychicId };
    expect(revealFreeForAll(input)).toEqual({ revealed: true });
    expect(revealFreeForAll(input)).toEqual({ revealed: false });

    const scores = all<{ score: number }>(
      "select score from players where room_id = ?",
      host.roomId,
    ).map((p) => p.score);
    expect(scores).toEqual([4, 4, 4]);
    expect(one("select phase, revealed_target from rounds where id = ?", roundId)).toEqual({
      phase: "reveal",
      revealed_target: target,
    });
  });

  it("rerolls the card, target and commitment together, and only once per card", async () => {
    const { gameId, roundId } = await roomWithGame(["Ada", "Bo"]);
    const before = one<{ card_id: string; target_commitment: Uint8Array }>(
      "select card_id, target_commitment from rounds where id = ?",
      roundId,
    )!;

    expect(rerollCard({ roundId, gameId, cardId: before.card_id })).toBe(true);
    // A second vote aimed at the card that is already gone changes nothing.
    expect(rerollCard({ roundId, gameId, cardId: before.card_id })).toBe(false);

    const after = one<{ card_id: string; target_commitment: Uint8Array }>(
      "select card_id, target_commitment from rounds where id = ?",
      roundId,
    )!;
    expect(after.card_id).not.toBe(before.card_id);

    const secret = one<{ target_center: number; nonce: Uint8Array }>(
      "select target_center, nonce from round_targets where round_id = ?",
      roundId,
    )!;
    const { commitment } = commitToTarget(secret.target_center, Buffer.from(secret.nonce));
    expect(Buffer.from(after.target_commitment).equals(commitment)).toBe(true);

    const used = all<{ card_id: string }>(
      "select card_id from game_used_cards where game_id = ?",
      gameId,
    ).map((row) => row.card_id);
    expect(used).toEqual(expect.arrayContaining([before.card_id, after.card_id]));
  });

  it("will not reroll once the clue is out", async () => {
    const { gameId, roundId } = await roomWithGame(["Ada", "Bo"]);
    const { card_id } = one<{ card_id: string }>("select card_id from rounds where id = ?", roundId)!;
    run("update rounds set clue = 'x', phase = 'guess' where id = ?", roundId);
    expect(rerollCard({ roundId, gameId, cardId: card_id })).toBe(false);
  });
});
