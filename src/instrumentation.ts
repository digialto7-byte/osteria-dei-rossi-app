import * as Sentry from "@sentry/nextjs";

/**
 * Runs once when a server instance starts. Validating the environment here makes a deployment
 * with a missing or invalid variable fail at boot with a named ConfigError, not on first use.
 */
export async function register() {
  const { readServerEnv } = await import("@/lib/env");
  const { sentryOptions } = await import("@/lib/observability/sentry");
  const env = readServerEnv();
  Sentry.init(sentryOptions(env.sentryDsn, env.deployment));
}

export const onRequestError = Sentry.captureRequestError;
