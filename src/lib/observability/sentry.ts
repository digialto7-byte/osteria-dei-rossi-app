import type { NodeOptions } from "@sentry/nextjs";
import type { Deployment } from "@/lib/env";
import { scrubEvent } from "./scrub";

export const NO_PERSONAL_DATA = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  genAI: { inputs: false, outputs: false },
  stackFrameVariables: false,
} as const satisfies NonNullable<NodeOptions["dataCollection"]>;

/**
 * Server-side Sentry options: off without a DSN, automatic collection of personal data off
 * (Sentry 11 `dataCollection`, which replaced `sendDefaultPii`), and every event scrubbed again
 * in beforeSend as a second layer (plan §3.11.8).
 */
export function sentryOptions(dsn: string | undefined, deployment: Deployment): NodeOptions {
  if (!dsn) return { enabled: false };
  return {
    enabled: true,
    dsn,
    environment: deployment,
    dataCollection: NO_PERSONAL_DATA,
    // Performance tracing is not needed yet; errors only.
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  };
}
