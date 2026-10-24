import { withApi } from "@/lib/api/with-api";
import { MAX_COUNT_BODY_BYTES } from "@/server/counts/constants";
import { listCritical, setCritical } from "@/server/counts/critical";
import { criticalBody } from "@/server/counts/schemas";

// A static segment: Next.js resolves /api/counts/critical here, never as the dynamic [id] route.
export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ supabase }) =>
  Response.json(await listCritical(supabase)),
);

export const PATCH = withApi(
  { roles: ["owner", "admin", "chef"], body: criticalBody, maxBodyBytes: MAX_COUNT_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await setCritical(supabase, body)),
);
