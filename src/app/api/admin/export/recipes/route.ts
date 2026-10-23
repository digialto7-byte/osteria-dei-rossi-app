import { withApi } from "@/lib/api/with-api";
import { exportRecipes } from "@/server/recipes/export";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ supabase }) =>
  Response.json(await exportRecipes(supabase)),
);
