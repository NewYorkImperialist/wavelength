import "server-only";

import { randomInt } from "node:crypto";

import { FREE_FOR_ALL_WINNING_SCORE } from "@/lib/game/constants";

import { all, isUniqueViolation, newId, nowIso, one, run, transaction } from "./db";
import { ApiError } from "./errors";
import { mintToken } from "./session";
import type { DbTeam } from "./guards";

/**
 * Room lifecycle: codes, joining, and seating.
 */

// No I, O, 0 or 1 — these get misread when someone reads a code aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_PLAYERS = 12;
const MAX_CODE_ATTEMPTS = 8;

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

export function normaliseName(raw: unknown): string {
  if (typeof raw !== "string") throw new ApiError("BAD_REQUEST", "A name is required.");
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > 24) {
    throw new ApiError("BAD_REQUEST", "Names must be 1 to 24 characters.");
  }
  return name;
}

function nextSeat(roomId: string, team: DbTeam): number {
  const row = one<{ seat: number | null }>(
    "select max(seat_order) as seat from players where room_id = ? and team = ?",
    roomId,
    team,
  );
  return (row?.seat ?? -1) + 1;
}

export interface JoinResult {
  readonly roomId: string;
  readonly code: string;
  readonly playerId: string;
  readonly token: string;
}

export async function createRoom(displayNameRaw: unknown): Promise<JoinResult> {
  const displayName = normaliseName(displayNameRaw);

  // Retry on collision rather than pre-checking: the partial unique index is
  // the authority on which codes are live.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    try {
      return transaction(() => {
        const roomId = newId();
        run(
          "insert into rooms (id, code, winning_score) values (?, ?, ?)",
          roomId,
          code,
          FREE_FOR_ALL_WINNING_SCORE,
        );
        const player = insertPlayer(roomId, displayName, "a", true);
        run("update rooms set host_player_id = ? where id = ?", player.playerId, roomId);
        return { roomId, code, ...player };
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue; // code already live, try another
      throw error;
    }
  }

  throw new ApiError("SERVER_ERROR", "Could not allocate a room code.");
}

function insertPlayer(
  roomId: string,
  displayName: string,
  team: DbTeam,
  isHost: boolean,
): { playerId: string; token: string } {
  const playerId = newId();
  run(
    `insert into players (id, room_id, display_name, team, is_host, seat_order)
     values (?, ?, ?, ?, ?, ?)`,
    playerId,
    roomId,
    displayName,
    team,
    isHost ? 1 : 0,
    nextSeat(roomId, team),
  );

  const { token, hash } = mintToken();
  run("insert into player_sessions (player_id, token_hash) values (?, ?)", playerId, hash);

  return { playerId, token };
}

export async function joinRoom(codeRaw: unknown, displayNameRaw: unknown): Promise<JoinResult> {
  const displayName = normaliseName(displayNameRaw);

  if (typeof codeRaw !== "string") throw new ApiError("BAD_REQUEST", "A room code is required.");
  const code = codeRaw.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    throw new ApiError("BAD_REQUEST", "That is not a valid room code.");
  }

  // One transaction, so two people taking the last seat at once cannot both
  // get it.
  return transaction(() => {
    const room = one<{ id: string; code: string; status: string }>(
      "select id, code, status from rooms where code = ? and status <> 'finished'",
      code,
    );
    if (room === null) throw new ApiError("NOT_FOUND", "No game with that code.");
    if (room.status !== "lobby") {
      throw new ApiError("CONFLICT", "That game has already started.");
    }

    const present = all<{ id: string }>(
      "select id from players where room_id = ? and left_at is null",
      room.id,
    );
    if (present.length >= MAX_PLAYERS) {
      throw new ApiError("CONFLICT", "That room is full.");
    }

    // Everyone sits on one side: free-for-all has no teams, and the round
    // machinery is built on a single active team.
    const player = insertPlayer(room.id, displayName, "a", false);
    run("update rooms set last_active_at = ? where id = ?", nowIso(), room.id);

    return { roomId: room.id, code: room.code, ...player };
  });
}
