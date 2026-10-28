import { withApi } from "@/lib/api/with-api";
import { MAX_MENU_BODY_BYTES } from "@/server/menu/constants";
import { createMenuItem, listMenuItems } from "@/server/menu/manage";
import { createMenuItemBody } from "@/server/menu/schemas";

// Managing the menu is for owner and admin; the procedures check the role again in Postgres.
const MANAGERS = ["owner", "admin"] as const;

export const GET = withApi({ roles: MANAGERS }, async ({ supabase }) =>
  Response.json(await listMenuItems(supabase)),
);

export const POST = withApi(
  { roles: MANAGERS, body: createMenuItemBody, maxBodyBytes: MAX_MENU_BODY_BYTES },
  async ({ supabase, body }) =>
    Response.json(await createMenuItem(supabase, body), { status: 201 }),
);
