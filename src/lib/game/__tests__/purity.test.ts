/**
 * The engine must run identically on the server and in the browser, so it may
 * not reach for React, Next, Supabase, node built-ins, or ambient globals.
 *
 * ESLint enforces this at edit time; this test enforces it in CI even if the
 * lint config is changed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ENGINE_DIR = join(process.cwd(), "src/lib/game");

function engineFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return engineFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const FILES = engineFiles(ENGINE_DIR);

const FORBIDDEN_IMPORTS = [
  "react",
  "react-dom",
  "next",
  "@supabase/",
  "node:",
  "server-only",
];

const FORBIDDEN_TOKENS = ["Math.random(", "Date.now(", "window.", "document."];

describe("engine purity", () => {
  it("finds the engine source files", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(FILES)("%s imports nothing environment-specific", (file) => {
    const source = readFileSync(file, "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(
          specifier === forbidden || specifier.startsWith(forbidden),
          `${file} imports "${specifier}"`,
        ).toBe(false);
      }
    }
  });

  it.each(FILES)("%s uses no ambient globals or hidden randomness", (file) => {
    const source = readFileSync(file, "utf8");
    for (const token of FORBIDDEN_TOKENS) {
      expect(source.includes(token), `${file} contains "${token}"`).toBe(false);
    }
  });
});
