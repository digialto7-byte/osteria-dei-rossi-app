import { withApi } from "@/lib/api/with-api";
import { MAX_STOCK_BODY_BYTES } from "@/server/stock/constants";
import { transferBody } from "@/server/stock/schemas";
import { postTransfer } from "@/server/stock/transfer";

export const POST = withApi(
  { roles: ["owner", "admin", "chef"], body: transferBody, maxBodyBytes: MAX_STOCK_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await postTransfer(supabase, body), { status: 201 }),
);
