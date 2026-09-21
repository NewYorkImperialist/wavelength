/**
 * Mint the anon and service_role keys for the local PostgREST stack.
 *
 * Supabase's "keys" are just JWTs signed with the project's JWT secret whose
 * `role` claim names a Postgres role. Nothing about them is Supabase-specific,
 * which is what lets a plain PostgREST stand in for the real API.
 */
import { SignJWT } from "jose";

const secret = process.argv[2];
if (!secret || secret.length < 32) {
  console.error("Usage: node scripts/make-keys.mjs <jwt-secret (32+ chars)>");
  process.exit(1);
}

const key = new TextEncoder().encode(secret);
const tenYears = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3650;

async function mint(role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(tenYears)
    .sign(key);
}

console.log(JSON.stringify({
  anon: await mint("anon"),
  service_role: await mint("service_role"),
}));
