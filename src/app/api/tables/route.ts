import { withApi } from "@/lib/api/with-api";
import { listTables } from "@/server/tables/list";

// Owner, admin and waiter read the tables; the chef gets 403 before any RPC (M17 plan §3.1.7, Q70).
export const GET = withApi({ roles: ["owner", "admin", "waiter"] }, async ({ supabase }) =>
  Response.json(await listTables(supabase)),
);
