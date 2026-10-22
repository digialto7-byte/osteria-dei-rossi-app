import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, errorResponse } from "@/lib/api/errors";
import { reportError } from "@/lib/observability/report";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const APP_ROLES = ["owner", "chef", "waiter", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** A signed-in user who belongs to a tenant (claims set by app.custom_access_token_hook). */
export interface TenantSession {
  authId: string;
  tenantId: string;
  role: AppRole;
}

/** Who may call a route: anyone, any signed-in user, or members of a tenant with these roles. */
type Access = { public: true } | { authenticated: true } | { roles: readonly AppRole[] };
type SessionFor<A extends Access> = A extends { roles: readonly AppRole[] }
  ? TenantSession
  : A extends { authenticated: true }
    ? { authId: string }
    : null;

type Options<
  A extends Access,
  S extends z.ZodType | undefined,
  P extends z.ZodType | undefined,
> = A & {
  body?: S;
  params?: P;
  /** Rejects larger bodies with 413 from Content-Length, before reading them. */
  maxBodyBytes?: number;
  /**
   * A multipart/form-data upload route (mutually exclusive with `body`). State-changing requests
   * must be multipart, same-origin, and declare a Content-Length within `maxBodyBytes`; all of
   * that is checked before the session lookup. The handler reads `request.formData()`.
   */
  multipart?: { maxBodyBytes: number };
};

export interface ApiContext<
  A extends Access,
  S extends z.ZodType | undefined,
  P extends z.ZodType | undefined = undefined,
> {
  request: Request;
  body: S extends z.ZodType ? z.infer<S> : undefined;
  params: P extends z.ZodType ? z.infer<P> : undefined;
  session: SessionFor<A>;
  supabase: SupabaseClient;
}

/** What Next.js 16 passes to a dynamic route handler. */
export interface RouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NO_STORE = "no-store";

const claimsSchema = z.object({
  sub: z.string().min(1),
  tenant_id: z.uuid().optional(),
  app_role: z.string().optional(),
});

function isJson(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function isMultipart(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.split(";")[0]?.trim().toLowerCase() === "multipart/form-data";
}

/** CSRF guard for the multipart route: Origin must be present and equal to the request's own. */
function checkMultipart(request: Request, maxBodyBytes: number): void {
  if (!isMultipart(request)) {
    throw new ApiError(415, "unsupported_media_type", "Usa Content-Type: multipart/form-data.");
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new ApiError(403, "invalid_origin", "Richiesta non consentita da questa origine.");
  }
  const length = request.headers.get("content-length");
  if (length === null || !/^\d+$/.test(length.trim())) {
    throw new ApiError(411, "length_required", "Manca la dimensione della richiesta.");
  }
  if (Number(length) > maxBodyBytes) {
    throw new ApiError(413, "payload_too_large", "Il file è troppo grande.");
  }
}

function strict(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodObject ? schema.strict() : schema;
}

async function readBody(request: Request, schema: z.ZodType): Promise<unknown> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Il corpo della richiesta non è JSON valido.");
  }
  const parsed = strict(schema).safeParse(raw);
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

// A malformed id gets the same 404 as a missing row, so it reveals nothing about existence.
async function readParams(context: RouteContext | undefined, schema: z.ZodType): Promise<unknown> {
  const parsed = schema.safeParse(context ? await context.params : undefined);
  if (!parsed.success) throw new ApiError(404, "not_found", "Risorsa non trovata.");
  return parsed.data;
}

async function resolveSession(access: Access, supabase: SupabaseClient) {
  if ("public" in access) return null;

  const { data, error } = await supabase.auth.getClaims();
  const claims = claimsSchema.safeParse(data?.claims);
  if (error || !claims.success) {
    throw new ApiError(401, "unauthenticated", "Accesso richiesto.");
  }
  if ("authenticated" in access) return { authId: claims.data.sub };

  const { tenant_id: tenantId, app_role: role } = claims.data;
  if (!tenantId) {
    throw new ApiError(403, "no_tenant", "Questo account non è abilitato per nessun locale.");
  }
  if (
    !(APP_ROLES as readonly string[]).includes(role ?? "") ||
    !access.roles.includes(role as AppRole)
  ) {
    throw new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
  }
  return { authId: claims.data.sub, tenantId, role: role as AppRole } satisfies TenantSession;
}

/**
 * Wraps a route handler with the checks every endpoint needs (plan §3.2), in this order:
 * JSON-only writes (CSRF; multipart routes: Origin and Content-Length) → session and role from the token claims → strict body parse.
 * RLS still decides which rows the user reaches; this only rejects early and uniformly.
 */
export function withApi<
  A extends Access,
  S extends z.ZodType | undefined = undefined,
  P extends z.ZodType | undefined = undefined,
>(
  options: Options<A, S, P>,
  handler: (context: ApiContext<A, S, P>) => Promise<Response>,
): (request: Request, context?: RouteContext) => Promise<Response> {
  if (options.multipart && options.body) {
    throw new Error("withApi: multipart and body are mutually exclusive");
  }
  return async (request, routeContext) => {
    let response: Response;
    try {
      if (STATE_CHANGING.has(request.method)) {
        if (options.multipart) {
          checkMultipart(request, options.multipart.maxBodyBytes);
        } else if (!isJson(request)) {
          throw new ApiError(415, "unsupported_media_type", "Usa Content-Type: application/json.");
        }
      }
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (options.maxBodyBytes !== undefined && declaredLength > options.maxBodyBytes) {
        throw new ApiError(413, "payload_too_large", "Il file è troppo grande.");
      }
      const supabase = await createSupabaseServerClient();
      const session = await resolveSession(options, supabase);
      const params = options.params ? await readParams(routeContext, options.params) : undefined;
      const body = options.body ? await readBody(request, options.body) : undefined;
      response = await handler({
        request,
        supabase,
        session: session as SessionFor<A>,
        body: body as ApiContext<A, S, P>["body"],
        params: params as ApiContext<A, S, P>["params"],
      });
    } catch (error) {
      if (error instanceof ApiError) {
        response = errorResponse(error.status, error.code, error.message, error.details);
      } else {
        reportError(error);
        response = errorResponse(500, "internal", "Errore interno. Riprova tra poco.");
      }
    }
    if (!response.headers.has("cache-control")) response.headers.set("cache-control", NO_STORE);
    return response;
  };
}
