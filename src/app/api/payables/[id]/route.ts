import { withApi } from "@/lib/api/with-api";
import { MAX_PAYABLE_BODY_BYTES } from "@/server/payables/constants";
import { getPayableDetail } from "@/server/payables/detail";
import { idParams, patchPayableBody } from "@/server/payables/schemas";
import { setPayableStatus } from "@/server/payables/status";

export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) => Response.json(await getPayableDetail(supabase, params.id)),
);

export const PATCH = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: patchPayableBody,
    maxBodyBytes: MAX_PAYABLE_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await setPayableStatus(supabase, params.id, body)),
);
