import { withApi } from "@/lib/api/with-api";
import { readCoperto, setCoperto } from "@/server/tables/coperto";
import { MAX_TABLES_BODY_BYTES } from "@/server/tables/constants";
import { copertoBody } from "@/server/tables/schemas";

const MANAGERS = ["owner", "admin"] as const;

export const GET = withApi({ roles: MANAGERS }, async ({ supabase }) =>
  Response.json(await readCoperto(supabase)),
);

export const PATCH = withApi(
  { roles: MANAGERS, body: copertoBody, maxBodyBytes: MAX_TABLES_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await setCoperto(supabase, body)),
);
