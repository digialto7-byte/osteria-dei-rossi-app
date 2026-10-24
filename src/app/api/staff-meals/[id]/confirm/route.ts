import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/batches/schemas";
import { confirmStaffMeal } from "@/server/staff-meals/confirm";
import { MAX_STAFF_MEAL_BODY_BYTES } from "@/server/staff-meals/constants";
import { confirmBody } from "@/server/staff-meals/schemas";

// Owner, admin and chef confirm today's staff meal; the waiter never (403 before any RPC).
export const POST = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: idParams,
    body: confirmBody,
    maxBodyBytes: MAX_STAFF_MEAL_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await confirmStaffMeal(supabase, params.id, body), { status: 201 }),
);
