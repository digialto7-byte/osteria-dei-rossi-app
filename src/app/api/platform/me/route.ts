import { withApi } from "@/lib/api/with-api";
import { meResponseSchema } from "@/lib/platform/api";
import { dbMe } from "@/server/platform/output";
import { callPlatform } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.4): the console shell's name and unread notices.
export const GET = withApi({ platform: true }, async ({ supabase }) =>
  Response.json(
    meResponseSchema.parse(await callPlatform(supabase, "platform_me", undefined, dbMe)),
  ),
);
