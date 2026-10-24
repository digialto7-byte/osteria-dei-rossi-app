import type { SupabaseClient } from "@supabase/supabase-js";
import { mapMenuDbError } from "./errors";
import { createMenuItemOutput, manageMenuOutput, updateMenuItemOutput } from "./output";
import type { CreateMenuItemBody, UpdateMenuItemBody } from "./schemas";

// The owner's and admin's side of the menu (M17 plan §3.4). Each write is one RPC, which is one transaction (the item,
// its price row and the audit event); this only passes the body and parses the answer.

/** GET /api/menu/items: every item with its mapping and price, plus the form data (VAT rates, courses, categories). */
export async function listMenuItems(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("menu_items_manage");
  if (error) throw mapMenuDbError(error);
  return manageMenuOutput.parse(data);
}

/** POST /api/menu/items. */
export async function createMenuItem(supabase: SupabaseClient, body: CreateMenuItemBody) {
  const { data, error } = await supabase.rpc("create_menu_item", { p_body: body });
  if (error) throw mapMenuDbError(error);
  return createMenuItemOutput.parse(data);
}

/** PATCH /api/menu/:id. A patch that changes nothing answers `changed: false` and writes nothing. */
export async function updateMenuItem(
  supabase: SupabaseClient,
  itemId: string,
  patch: UpdateMenuItemBody,
) {
  const { data, error } = await supabase.rpc("update_menu_item", {
    p_item: itemId,
    p_patch: patch,
  });
  if (error) throw mapMenuDbError(error);
  return updateMenuItemOutput.parse(data);
}
