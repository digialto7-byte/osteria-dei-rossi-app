import { withApi } from "@/lib/api/with-api";
import { MAX_OPENING_BODY_BYTES } from "@/server/opening/constants";
import { putOpeningDraftLines } from "@/server/opening/draft";
import { draftPutBody } from "@/server/opening/schemas";

// Opening stock (plan 2026-11-18 §3.9): upserts draft lines by their client ids; owner and admin only.
export const PUT = withApi(
  { roles: ["owner", "admin"], body: draftPutBody, maxBodyBytes: MAX_OPENING_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await putOpeningDraftLines(supabase, body)),
);
