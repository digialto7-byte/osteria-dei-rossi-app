import { withApi } from "@/lib/api/with-api";
import { MAX_RULES_BODY_BYTES } from "@/server/rules/constants";
import { supplierRulesBody } from "@/server/rules/schemas";
import { listSupplierRules, setSupplierRules } from "@/server/rules/suppliers";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ supabase }) =>
  Response.json(await listSupplierRules(supabase)),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], body: supplierRulesBody, maxBodyBytes: MAX_RULES_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await setSupplierRules(supabase, body)),
);
