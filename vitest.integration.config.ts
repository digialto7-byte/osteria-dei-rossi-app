import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Real-stack suite: needs `npx supabase start` (Auth, PostgREST, Storage) and the settings that
// CI exports from `supabase status`. Kept apart from vitest.config.ts so `npm test` stays offline.
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
    include: ["tests/integration/**/*.int.ts"],
    // Files share one database; the TTL test also waits on the clock.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
