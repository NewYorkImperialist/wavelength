import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "./env";

/**
 * The service-role client. Bypasses row level security entirely, so every
 * caller is responsible for its own authorization — see `guards.ts`.
 *
 * This is the ONLY writer in the system. Browsers hold no write grant.
 */
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  cached ??= createClient(serverEnv.supabaseUrl, serverEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "wavelength-server" } },
  });
  return cached;
}
