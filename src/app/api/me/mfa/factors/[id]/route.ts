import { withApi } from "@/lib/api/with-api";
import { removeFactor } from "@/server/auth/mfa";
import { factorParams, removeOutput } from "@/server/auth/mfa-schemas";

// P2-1: remove one of the account's own factors.
export const DELETE = withApi(
  { roles: ["owner", "admin"], mfa: "exempt", params: factorParams },
  async ({ supabase, params }) =>
    Response.json(removeOutput.parse(await removeFactor(supabase, params.id))),
);
