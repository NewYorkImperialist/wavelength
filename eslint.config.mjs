import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // The game engine is pure: it must run identically on the server (for
  // authority) and in the browser (for optimistic display). Nothing in it may
  // reach for React, Next, Supabase or Node built-ins.
  {
    files: ["src/lib/game/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "next", "next/*"], message: "src/lib/game must stay React/Next-free." },
            { group: ["@supabase/*"], message: "src/lib/game must stay I/O-free." },
            { group: ["node:*", "server-only"], message: "src/lib/game must run in the browser too." },
            { group: ["@/lib/server/*", "@/components/*", "@/app/*"], message: "The engine may not depend on outer layers." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "src/lib/game must stay environment-agnostic." },
        { name: "document", message: "src/lib/game must stay environment-agnostic." },
      ],
    },
  },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**"]),
]);

export default eslintConfig;
