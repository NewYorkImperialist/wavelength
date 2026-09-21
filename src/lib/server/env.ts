import "server-only";

/**
 * Server-side configuration.
 *
 * `import "server-only"` above turns any accidental import of this module from
 * a client component into a build error — the second line of defence behind
 * the absent NEXT_PUBLIC_ prefix, which already stops Next from inlining these
 * values into the browser bundle.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const serverEnv = {
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get serviceRoleKey(): string {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get jwtSecret(): string {
    return required("SUPABASE_JWT_SECRET");
  },
};
