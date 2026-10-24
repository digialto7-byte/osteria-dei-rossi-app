import { withApi } from "@/lib/api/with-api";
import { MAX_MENU_BODY_BYTES } from "@/server/menu/constants";
import { updateMenuItem } from "@/server/menu/manage";
import { idParams, updateMenuItemBody } from "@/server/menu/schemas";

export const PATCH = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: updateMenuItemBody,
    maxBodyBytes: MAX_MENU_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await updateMenuItem(supabase, params.id, body)),
);
