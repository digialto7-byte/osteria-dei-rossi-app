import { withApi } from "@/lib/api/with-api";
import { saveCountLines } from "@/server/counts/lines";
import { MAX_COUNT_BODY_BYTES } from "@/server/counts/constants";
import { countLinesBody, idParams } from "@/server/counts/schemas";

export const PUT = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: idParams,
    body: countLinesBody,
    maxBodyBytes: MAX_COUNT_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await saveCountLines(supabase, params.id, body)),
);
