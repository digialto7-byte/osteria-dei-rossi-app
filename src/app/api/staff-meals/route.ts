import { withApi } from "@/lib/api/with-api";
import { listStaffMealRules, saveStaffMealRule } from "@/server/staff-meals/rules";
import { MAX_STAFF_MEAL_BODY_BYTES } from "@/server/staff-meals/constants";
import { ruleBody } from "@/server/staff-meals/schemas";

// Owner, admin and chef read and set the rules (founder, M12 Q1; Q52 default); the waiter never.
export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ supabase }) =>
  Response.json(await listStaffMealRules(supabase)),
);

export const POST = withApi(
  { roles: ["owner", "admin", "chef"], body: ruleBody, maxBodyBytes: MAX_STAFF_MEAL_BODY_BYTES },
  async ({ supabase, body }) => {
    const { created, rule } = await saveStaffMealRule(supabase, body);
    return Response.json(rule, { status: created ? 201 : 200 });
  },
);
