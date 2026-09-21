"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client.
 *
 * Read-only in practice: `anon` and `authenticated` hold no write grant on any
 * table, so every mutation goes through a route handler instead. This client
 * exists for realtime subscriptions and for reading the caller's own room.
 */

let client: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || anonKey === undefined) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local.",
    );
  }

  client ??= createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 30 } },
  });
  return client;
}

export interface RealtimeToken {
  readonly token: string;
  readonly expiresAt: number;
}

/** Swap the anon identity for the room-scoped token RLS actually reads. */
export async function authenticateForRoom(roomId: string): Promise<RealtimeToken> {
  const response = await fetch(
    `/api/session/realtime-token?roomId=${encodeURIComponent(roomId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not authenticate for this room.");

  const token = (await response.json()) as RealtimeToken;
  const supabase = browserClient();
  supabase.realtime.setAuth(token.token);
  return token;
}
