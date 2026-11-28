import { withApi } from "@/lib/api/with-api";
import { noticesResponseSchema } from "@/lib/platform/api";
import { dbNotices } from "@/server/platform/output";
import { callPlatform } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.5, AT9): Avvisi, newest first.
export const GET = withApi({ platform: true }, async ({ supabase }) =>
  Response.json(
    noticesResponseSchema.parse({
      notices: await callPlatform(supabase, "platform_notices", undefined, dbNotices),
    }),
  ),
);
