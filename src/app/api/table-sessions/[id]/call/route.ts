import { withApi } from "@/lib/api/with-api";
import { callUscita } from "@/server/orders/call";
import { MAX_CALL_BODY_BYTES } from "@/server/orders/constants";
import { callBody, idParams } from "@/server/orders/schemas";
import { measured, timedJson } from "@/server/orders/timing";

// Comanda per uscita: "Via la n". Owner, admin and waiter; the chef gets 403 before any RPC (the kitchen's "Via" is PR5, after P0).
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: callBody,
    maxBodyBytes: MAX_CALL_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => callUscita(supabase, params.id, body));
    return timedJson(result, header);
  },
);
