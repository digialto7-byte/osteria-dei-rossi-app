import "server-only";
import type { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { RouteContext } from "@/lib/api/with-api";
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

/**
 * The first `x-forwarded-for` entry, cut to 64 characters; null when there is none or it is blank. The request route then answers 400 invalid_request before any RPC
 * (the database refuses a request with no address as well), so a request cannot slip past the per-address limit by hiding its address.
 *
 * The first entry is trusted only because Vercel overwrites the header with the address it saw, so a visitor cannot choose it
 * (https://vercel.com/docs/headers/request-headers#x-forwarded-for). Behind any other proxy or CDN that no longer holds and every visitor would share the proxy's
 * address: read `x-vercel-forwarded-for` instead (docs/guides/prenotazioni.md, "The client address").
 */
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

/**
 * Adds `X-Robots-Tag: noindex` to every answer of a route, errors included (the cancel link is a private page). Wrap the whole `withApi` handler, because
 * its error answers are built inside it.
 */
export function withNoindex(
  handler: (request: Request, context?: RouteContext) => Promise<Response>,
): (request: Request, context?: RouteContext) => Promise<Response> {
  return async (request, context) => {
    const response = await handler(request, context);
    response.headers.set("x-robots-tag", "noindex");
    return response;
  };
}
