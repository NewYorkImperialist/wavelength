import "server-only";

/**
 * Server-side configuration.
 *
 * `import "server-only"` turns any accidental import of this module from a
 * client component into a build error — the second line of defence behind the
 * absent NEXT_PUBLIC_ prefix, which already stops Next inlining the secrets
 * into the browser bundle.
 *
 * Every lookup below writes `process.env.SOME_NAME` out in full, deliberately.
 * Next replaces NEXT_PUBLIC_* references at BUILD time by static text
 * substitution, so a dynamic lookup like `process.env[name]` is not replaced
 * and reads as undefined at runtime. That failed only in a production
 * container — locally, .env.local populates process.env for real, so the
 * dynamic form worked and hid the problem.
 */

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/**
 * Whether multiplayer can work at all. The single-device game at /local needs
 * none of this, so the UI checks here rather than failing with an opaque 500.
 */
export function isSupabaseConfigured(): boolean {
  return (
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") !== "" &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") !== ""
  );
}

export const serverEnv = {
  get supabaseUrl(): string {
    return required(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  },
  get serviceRoleKey(): string {
    return required(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  },
};
