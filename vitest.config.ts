import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The "server-only" marker is resolved by Next.js at build time; tests get an empty module.
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "scripts/**/*.ts"],
      // Thin entry points: the screens and the CLI wrapper are exercised by Playwright and the
      // CI create-tenant step; the logic they call is unit-tested.
      exclude: [
        "src/**/*.tsx",
        "scripts/create-tenant.ts",
        "scripts/spike/t1-staff-auth.ts",
        "src/instrumentation.ts",
      ],
      thresholds: { lines: 80 },
    },
  },
});
