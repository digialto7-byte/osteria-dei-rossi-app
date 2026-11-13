import type { MessageKey } from "@/lib/i18n";
import { canEditMasterData } from "@/lib/master/master-access";

// What an empty screen says and offers next (UX plan P1-2). Pure: it chooses the words and the one link for a role; the
// EmptyState component draws them. A link is only offered to a role that can open and use the target; until the role is
// known (null) there is text only, so no link flashes in and out.

export type EmptyScreen =
  | "suppliers"
  | "ingredients"
  | "stock"
  | "costs"
  | "margins"
  | "recipes"
  | "tables"
  | "devices"
  | "criticalCounts"
  | "batchRecipes";

export interface EmptyAction {
  labelKey: MessageKey;
  href: string;
}
export interface EmptyContent {
  messageKey: MessageKey;
  action: EmptyAction | null;
}

/**
 * The roles POST /api/recipes allows, mirrored here so "Crea una ricetta" is offered to exactly them (QW8). Keep in step with
 * `READERS` in src/app/api/recipes/route.ts; a test reads that file and fails if the two differ. The API stays the guard.
 */
export const RECIPE_WRITER_ROLES = ["owner", "admin", "chef"] as const;

const IMPORT: EmptyAction = { labelKey: "empty.import", href: "/anagrafiche/importa" };
const INVOICES: EmptyAction = { labelKey: "empty.invoices", href: "/fatture" };
const CREATE_RECIPE: EmptyAction = { labelKey: "empty.createRecipe", href: "/ricette/nuova" };
const ADD_TABLES: EmptyAction = { labelKey: "empty.addTables", href: "/tavoli/impostazioni" };
const ADD_STAFF: EmptyAction = { labelKey: "empty.addStaff", href: "/personale" };

/** The message and the next step of an empty list, for the signed-in role (null while it loads). */
export function emptyFor(screen: EmptyScreen, role: string | null): EmptyContent {
  const manager = role !== null && canEditMasterData(role);
  const onlyIf = (allowed: boolean, action: EmptyAction): EmptyAction | null =>
    allowed ? action : null;
  switch (screen) {
    case "suppliers":
    case "ingredients":
      return { messageKey: "common.empty", action: onlyIf(manager, IMPORT) };
    case "stock":
      return role === "chef"
        ? { messageKey: "stock.empty.chef", action: null }
        : { messageKey: "stock.empty", action: onlyIf(manager, INVOICES) };
    case "criticalCounts":
      return { messageKey: "count.critical.empty", action: onlyIf(manager, INVOICES) };
    case "costs":
      return { messageKey: "costs.empty", action: onlyIf(manager, CREATE_RECIPE) };
    case "margins":
      return { messageKey: "margins.empty", action: onlyIf(role === "chef", CREATE_RECIPE) };
    case "recipes":
      return { messageKey: "recipes.empty", action: onlyIf(manager, IMPORT) };
    case "tables":
      return manager
        ? { messageKey: "tables.noTables.manager", action: ADD_TABLES }
        : { messageKey: "tables.noTables", action: null };
    case "batchRecipes":
      return {
        messageKey: "production.noRecipes",
        action: onlyIf(
          role !== null && (RECIPE_WRITER_ROLES as readonly string[]).includes(role),
          CREATE_RECIPE,
        ),
      };
    case "devices":
      return { messageKey: "devices.empty", action: onlyIf(manager, ADD_STAFF) };
  }
}
