import { z } from "zod";

// Runs in the browser before the app's own code (Next.js instrumentation-client). Under the nonce policy (ADR-028) Zod 4's first
// object parse probes `new Function("")` for its JIT fast path; the probe is caught, but a strict CSP still reports it as a
// violation on every screen that parses. `jitless` skips the probe; parsing works the same, without the JIT.
z.config({ jitless: true });
