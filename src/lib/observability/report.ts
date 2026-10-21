import * as Sentry from "@sentry/nextjs";

/** Sends an unexpected error to Sentry (scrubbed by beforeSend); never to the client. */
export function reportError(error: unknown): void {
  Sentry.captureException(error);
}
