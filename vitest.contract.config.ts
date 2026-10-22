import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live contract suite (AT8): calls the real model API, so it runs only from the manual
// "Extraction contract" workflow (or by hand with the two env variables set). Never in `npm test`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/contract/**/*.contract.ts"],
    // 10 invoices plus the synthetic one, each allowed a little over the 60 s model-call limit.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
