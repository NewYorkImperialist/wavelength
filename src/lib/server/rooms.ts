import "server-only";

import { randomInt } from "node:crypto";

import { serviceClient } from "./db";
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

async function nextSeat(roomId: string, team: DbTeam): Promise<number> {
  const db = serviceClient();
  const { data } = await db
    .from("players")
    .select("seat_order")
    .eq("room_id", roomId)
    .eq("team", team)
    .order("seat_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ seat_order: number }>();
  return (data?.seat_order ?? -1) + 1;
}

export interface JoinResult {
  readonly roomId: string;
  readonly code: string;
  readonly playerId: string;
  readonly token: string;
}

export async function createRoom(displayNameRaw: unknown): Promise<JoinResult> {
  const db = serviceClient();
  const displayName = normaliseName(displayNameRaw);

  // Retry on collision rather than pre-checking: the partial unique index is
  // the authority, and a check-then-insert would race.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { data: room, error } = await db
      .from("rooms")
      .insert({ code })
      .select("id, code")
      .single<{ id: string; code: string }>();

    if (error !== null) {
      if (error.code === "23505") continue; // code already live, try another
      throw new ApiError("SERVER_ERROR", "Could not create the room.");
    }
    if (room === null) throw new ApiError("SERVER_ERROR", "Could not create the room.");

    const player = await insertPlayer(room.id, displayName, "a", true);
    await db.from("rooms").update({ host_player_id: player.playerId }).eq("id", room.id);

    return { roomId: room.id, code: room.code, ...player };
  }

  throw new ApiError("SERVER_ERROR", "Could not allocate a room code.");
}

async function insertPlayer(
  roomId: string,
  displayName: string,
  team: DbTeam,
  isHost: boolean,
): Promise<{ playerId: string; token: string }> {
  const db = serviceClient();
  const seat = await nextSeat(roomId, team);

  const { data: player, error } = await db
    .from("players")
    .insert({ room_id: roomId, display_name: displayName, team, is_host: isHost, seat_order: seat })
    .select("id")
    .single<{ id: string }>();

  if (error !== null || player === null) {
    throw new ApiError("SERVER_ERROR", "Could not add the player.");
  }

  const { token, hash } = mintToken();
  const { error: sessionError } = await db.rpc("create_player_session", {
    p_player_id: player.id,
    p_token_hash: `\\x${hash.toString("hex")}`,
  });
  if (sessionError !== null) throw new ApiError("SERVER_ERROR", "Could not start a session.");

  return { playerId: player.id, token };
}

export async function joinRoom(codeRaw: unknown, displayNameRaw: unknown): Promise<JoinResult> {
  const db = serviceClient();
  const displayName = normaliseName(displayNameRaw);

  if (typeof codeRaw !== "string") throw new ApiError("BAD_REQUEST", "A room code is required.");
  const code = codeRaw.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    throw new ApiError("BAD_REQUEST", "That is not a valid room code.");
  }

  const { data: room, error } = await db
    .from("rooms")
    .select("id, code, status")
    .eq("code", code)
    .neq("status", "finished")
    .maybeSingle<{ id: string; code: string; status: string }>();

  if (error !== null) throw new ApiError("SERVER_ERROR", "Could not look up the room.");
  if (room === null) throw new ApiError("NOT_FOUND", "No game with that code.");
  if (room.status !== "lobby") {
    throw new ApiError("CONFLICT", "That game has already started.");
  }

  const { count } = await db
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id)
    .is("left_at", null);

  if ((count ?? 0) >= MAX_PLAYERS) {
    throw new ApiError("CONFLICT", "That room is full.");
  }

  // Seat onto the smaller team so lobbies stay roughly even by default.
  const { data: existing } = await db
    .from("players")
    .select("team")
    .eq("room_id", room.id)
    .is("left_at", null)
    .returns<{ team: DbTeam | null }[]>();

  const aCount = (existing ?? []).filter((p) => p.team === "a").length;
  const bCount = (existing ?? []).filter((p) => p.team === "b").length;
  const team: DbTeam = aCount <= bCount ? "a" : "b";

  const player = await insertPlayer(room.id, displayName, team, false);
  await db.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("id", room.id);

  return { roomId: room.id, code: room.code, ...player };
}
