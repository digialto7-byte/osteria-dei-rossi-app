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

type Options<A extends Access, S extends z.ZodType | undefined> = A & { body?: S };

export interface ApiContext<A extends Access, S extends z.ZodType | undefined> {
  request: Request;
  body: S extends z.ZodType ? z.infer<S> : undefined;
  session: SessionFor<A>;
  supabase: SupabaseClient;
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
 * JSON-only writes (CSRF) → session and role from the token claims → strict body parse.
 * RLS still decides which rows the user reaches; this only rejects early and uniformly.
 */
export function withApi<A extends Access, S extends z.ZodType | undefined = undefined>(
  options: Options<A, S>,
  handler: (context: ApiContext<A, S>) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let response: Response;
    try {
      if (STATE_CHANGING.has(request.method) && !isJson(request)) {
        throw new ApiError(415, "unsupported_media_type", "Usa Content-Type: application/json.");
      }
      const supabase = await createSupabaseServerClient();
      const session = await resolveSession(options, supabase);
      const body = options.body ? await readBody(request, options.body) : undefined;
      response = await handler({
        request,
        supabase,
        session: session as SessionFor<A>,
        body: body as ApiContext<A, S>["body"],
      });
    } catch (error) {
      if (error instanceof ApiError) {
        response = errorResponse(error.status, error.code, error.message);
      } else {
        reportError(error);
        response = errorResponse(500, "internal", "Errore interno. Riprova tra poco.");
      }
    }
    if (!response.headers.has("cache-control")) response.headers.set("cache-control", NO_STORE);
    return response;
  };
}
