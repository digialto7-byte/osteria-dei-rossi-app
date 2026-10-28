import type { MessageKey } from "@/lib/i18n";

// What "Oggi" offers each role (plan 3.2, P0): ordered actions, no counts yet, no money words for the chef.
// Pure: it only chooses and orders links; the page shows them.

export interface TodayAction {
  labelKey: MessageKey;
  hintKey: MessageKey;
  href: string;
  /** The one action that moves the work forward; the page draws it as the primary link. */
  primary: boolean;
}

export interface FirstStep {
  labelKey: MessageKey;
  href: string;
}

const action = (
  labelKey: MessageKey,
  hintKey: MessageKey,
  href: string,
  primary = false,
): TodayAction => ({ labelKey, hintKey, href, primary });

const TABLES = action("home.tables", "today.hint.tables", "/tavoli");
const TICKETS = action("nav.tickets", "today.hint.tickets", "/cucina");
const MENU = action("home.menu", "today.hint.menu", "/menu");

const ACTIONS: Record<string, TodayAction[]> = {
  owner: [
    action("today.uploadInvoice", "today.hint.uploadInvoice", "/fatture", true),
    action("home.alerts", "today.hint.alerts", "/avvisi"),
    TICKETS,
    action("home.payables", "today.hint.payables", "/pagamenti"),
    action("today.costs", "today.hint.costs", "/costi"),
    TABLES,
    MENU,
  ],
  admin: [
    action("today.staff", "today.hint.staff", "/personale", true),
    action("today.import", "today.hint.import", "/anagrafiche/importa"),
    MENU,
    TABLES,
    TICKETS,
    action("nav.invoices", "today.hint.invoices", "/fatture"),
  ],
  // The chef's list has no money word and no link to a page with amounts.
  chef: [
    action("today.newProduction", "today.hint.newProduction", "/produzione/nuova", true),
    TICKETS,
    action("today.prep", "today.hint.prep", "/avvisi"),
    action("today.dailyCount", "today.hint.dailyCount", "/magazzino/conteggi"),
    action("today.waste", "today.hint.waste", "/magazzino"),
    action("staffMeal.title", "today.hint.staffMeals", "/produzione/personale"),
  ],
  // The waiter is sent to the tables instead (landingFor in nav-model.ts).
  waiter: [],
};

/** The actions of Oggi for a role, the primary first. Empty for the waiter and for an unknown role. */
export function todayActions(role: string): TodayAction[] {
  return ACTIONS[role] ?? [];
}

// The owner's and admin's checklist for a new venue. Static for now; labels differ from the actions above so that
// every link on the page has a name of its own.
const FIRST_STEPS: FirstStep[] = [
  { labelKey: "nav.locations", href: "/anagrafiche/ubicazioni" },
  { labelKey: "nav.suppliers", href: "/anagrafiche/fornitori" },
  { labelKey: "nav.ingredients", href: "/anagrafiche/ingredienti" },
  { labelKey: "today.step.invoice", href: "/fatture" },
  { labelKey: "today.step.staff", href: "/personale" },
  { labelKey: "today.step.floor", href: "/tavoli" },
];

/** "Primi passi" for the owner and admin; nothing for the others. */
export function firstSteps(role: string): FirstStep[] {
  return role === "owner" || role === "admin" ? FIRST_STEPS : [];
}
