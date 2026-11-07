import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// One-call smoke contract: sends a single real request to the model API, so it runs only from the
// manual "Extraction contract" workflow (or by hand with the two env variables set). Never in
// `npm test`, and not part of `test:contract` (its glob is *.contract.ts, this one is *.smoke.ts).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/contract/**/*.smoke.ts"],
    testTimeout: 90_000,
  },
});
