/**
 * Guard against a bug that only appears in production.
 *
 * Next replaces `process.env.NEXT_PUBLIC_*` at build time by static text
 * substitution. A dynamic lookup — `process.env[name]` — is not replaced, so
 * it reads as undefined inside a built container while working perfectly in
 * development, where .env.local populates process.env for real.
 *
 * That cost a deploy. This makes it impossible to reintroduce quietly.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Comments legitimately discuss the forbidden pattern; strip them first. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const FILES = [
  ...sourceFiles(join(process.cwd(), "src/lib")),
  ...sourceFiles(join(process.cwd(), "src/app")),
  ...sourceFiles(join(process.cwd(), "src/components")),
];

describe("environment variable access", () => {
  it("finds source files to check", () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it.each(FILES)("%s reads env vars by static name", (file) => {
    const source = stripComments(readFileSync(file, "utf8"));
    // A computed key is the form Next cannot inline.
    expect(source).not.toMatch(/process\.env\s*\[/);
  });

  it("never exposes a secret through a NEXT_PUBLIC_ name", () => {
    for (const file of FILES) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SERVICE_ROLE|SECRET|JWT)/);
    }
  });
});
