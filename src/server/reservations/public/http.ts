import type { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { ConfigError, readReservationEnv, type ReservationEnv } from "@/lib/env";
import { reportError } from "@/lib/observability/report";
import { unconfigured } from "./errors";
import type { LinkKeys } from "./tokens";

/** Origin must be present and equal to the request's own (CSRF; a customer's browser always sends it on a POST). Checked before the body is read. */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new ApiError(403, "invalid_origin", t("publicReservationError.origin"));
  }
}

/**
 * Reads and parses a JSON body of at most `maxBytes`, counting the bytes actually read, so a stream with no Content-Length is held to the limit too.
 * Field names of a failed parse are named, values never are (they are the customer's data).
 */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes: number,
): Promise<z.infer<S>> {
  const tooLarge = () =>
    new ApiError(413, "payload_too_large", t("publicReservationError.too_large"));
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "Il corpo della richiesta non è JSON valido.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.flatMap((issue) =>
      issue.code === "unrecognized_keys" ? issue.keys : [issue.path.join(".") || "(body)"],
    );
    throw new ApiError(
      400,
      "invalid_request",
      `Campi non validi: ${[...new Set(fields)].join(", ")}`,
    );
  }
  return parsed.data;
}

/** The first `x-forwarded-for` entry, cut to 64 characters; null when there is none (the e-mail and phone limits still hold; plan T-R4). */
export function clientIp(request: Request): string | null {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : null;
}

/** The keys of the public routes. Missing or short keys are a deployment mistake: the operator is told (variable names only), the customer sees 503. */
export function loadReservationEnv(): ReservationEnv {
  try {
    return readReservationEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      reportError(error);
      throw unconfigured();
    }
    throw error;
  }
}

export const linkKeys = (env: ReservationEnv): LinkKeys => ({
  current: env.linkKey,
  previous: env.linkKeyPrevious,
});
