import { withApi } from "@/lib/api/with-api";
import { MAX_KITCHEN_BODY_BYTES } from "@/server/kitchen/constants";
import { markKitchenTicket } from "@/server/kitchen/marks";
import { markTicketBody } from "@/server/kitchen/schemas";
import { measured } from "@/server/orders/timing";

// Chef, owner and admin close or reopen a comanda; the waiter gets 403 before any RPC. Never cached.
export const POST = withApi(
  { roles: ["chef", "owner", "admin"], body: markTicketBody, maxBodyBytes: MAX_KITCHEN_BODY_BYTES },
  async ({ supabase, body, timing }) => {
    const { result, header } = await measured(timing, () => markKitchenTicket(supabase, body));
    return Response.json(result, {
      headers: { "server-timing": header, "cache-control": "no-store" },
    });
  },
);
