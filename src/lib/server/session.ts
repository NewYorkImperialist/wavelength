import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { ApiError } from "./errors";
import { one } from "./db";

/**
 * Anonymous identity.
 *
 * A player is a 256-bit bearer token. Only its SHA-256 is stored, and the
 * token itself is an httpOnly cookie — so an XSS bug anywhere in the app (or a
 * hostile custom spectrum card) cannot read a session out of the document and
 * impersonate the Psychic.
 *
 * The display name is never an identifier.
 */

const TOKEN_BYTES = 32;

/** Per-room cookie, so one person can be in two rooms in two tabs. */
export function sessionCookieName(roomId: string): string {
  return `wl_s_${roomId.slice(0, 8)}`;
}

export function mintToken(): { token: string; hash: Buffer } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: sha256(token) };
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export async function setSessionCookie(roomId: string, token: string): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(roomId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Not scoped to /api: Server Components read it during SSR too.
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export interface Actor {
  readonly playerId: string;
  readonly roomId: string;
  readonly team: "a" | "b" | null;
  readonly isHost: boolean;
  readonly displayName: string;
}

/**
 * Resolve the caller from their cookie, and prove they belong to this room.
 *
 * Identity is NEVER taken from the request body. A player id may appear in a
 * request as the *subject* of an action, never as the actor performing it.
 */
export async function requireActor(roomId: string): Promise<Actor> {
  const store = await cookies();
  const token = store.get(sessionCookieName(roomId))?.value;
  if (token === undefined || token === "") {
    throw new ApiError("UNAUTHENTICATED", "No session for this room.");
  }

  const player = one<{
    id: string;
    room_id: string;
    team: "a" | "b" | null;
    is_host: number;
    display_name: string;
    left_at: string | null;
  }>(
    `select p.id, p.room_id, p.team, p.is_host, p.display_name, p.left_at
       from player_sessions s
       join players p on p.id = s.player_id
      where s.token_hash = ?`,
    sha256(token),
  );

  if (player === null) throw new ApiError("UNAUTHENTICATED", "Unrecognised session.");
  if (player.room_id !== roomId) {
    throw new ApiError("FORBIDDEN", "You are not in this room.");
  }
  if (player.left_at !== null) {
    throw new ApiError("FORBIDDEN", "You have left this room.");
  }

  return {
    playerId: player.id,
    roomId: player.room_id,
    team: player.team,
    isHost: player.is_host === 1,
    displayName: player.display_name,
  };
}
