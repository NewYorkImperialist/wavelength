"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client, used for realtime only.
 *
 * It never reads a table. All state comes from `/api/rooms/:id/state`, which
 * is the single place that decides what a given player may see. That is why
 * the plain anon key is enough here: there is nothing to authorize beyond
 * joining a channel whose name is an unguessable room id, and the messages on
 * it carry no game data.
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
