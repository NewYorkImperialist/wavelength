import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` ships a module that throws outside a React Server
      // Component. Its job is a build-time guard for Next, which Next still
      // enforces; under Vitest it just needs to be inert.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Engine tests are pure and need no DOM. Component tests opt into jsdom
    // with a `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    coverage: { provider: "v8", include: ["src/lib/game/**"] },
  },
});
