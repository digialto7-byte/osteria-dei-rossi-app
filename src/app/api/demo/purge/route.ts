import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { purgeDemoTenant } from "@/server/demo/purge";

/** The body is one name; 1 KiB is generous. */
const MAX_DEMO_BODY_BYTES = 1024;

// Not trimmed: the server compares the exact text with the tenant name.
const body = z.strictObject({ confirmName: z.string().min(1).max(200) });

export const POST = withApi(
  { roles: ["owner"], body, maxBodyBytes: MAX_DEMO_BODY_BYTES },
  async ({ supabase, body: { confirmName } }) => {
    await purgeDemoTenant(supabase, confirmName);
    return Response.json({ purged: true });
  },
);
