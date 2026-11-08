import { describe, expect, it } from "vitest";
import { z } from "zod";

// M25 CI run 42384566794: with the nonce policy (ADR-028), Zod 4's first object parse probes `new Function("")` to decide on its JIT
// fast path. The probe is caught, but a strict CSP still reports it ("script-src blocked eval") on every screen that parses. Zod's
// `jitless` setting skips the probe. Next.js runs src/instrumentation-client.ts in the browser before the app's own code.
describe("src/instrumentation-client.ts", () => {
  it("turns off Zod's eval probe before any schema is parsed", async () => {
    await import("@/instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });
});
