import { withApi } from "@/lib/api/with-api";
import { MAX_STOCK_BODY_BYTES } from "@/server/stock/constants";
import { wasteBody } from "@/server/stock/schemas";
import { postWaste } from "@/server/stock/waste";

// Owner, admin and chef write stock through the procedures (Q1 = owner+chef+admin, founder 2026-10-23).
export const POST = withApi(
  { roles: ["owner", "admin", "chef"], body: wasteBody, maxBodyBytes: MAX_STOCK_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await postWaste(supabase, body), { status: 201 }),
);
