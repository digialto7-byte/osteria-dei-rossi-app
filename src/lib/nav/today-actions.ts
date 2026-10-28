import type { MessageKey } from "@/lib/i18n";
import type { CardKey, SetupKey, SetupStep, TodayCard } from "@/server/today/types";

// What "Oggi" offers each role (plan 3.2): ordered actions, the badge each one gets from /api/today (counts only, no
// money for anyone) and the set-up progress. No money words for the chef. Pure: it only chooses, orders and words things;
// the page shows them.

export interface TodayAction {
  labelKey: MessageKey;
  hintKey: MessageKey;
  href: string;
  /** The one action that moves the work forward; the page draws it as the primary link. */
  primary: boolean;
  /** The /api/today cards that tell its state, most urgent first; none for an action with no count. */
  cards?: readonly CardKey[];
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
  cards?: readonly CardKey[],
): TodayAction => ({ labelKey, hintKey, href, primary, ...(cards && { cards }) });

const TABLES = action("home.tables", "today.hint.tables", "/tavoli");
const TICKETS = action("nav.tickets", "today.hint.tickets", "/cucina");
const MENU = action("home.menu", "today.hint.menu", "/menu");

const ACTIONS: Record<string, TodayAction[]> = {
  owner: [
    action("today.uploadInvoice", "today.hint.uploadInvoice", "/fatture", true, [
      "invoicesToReview",
    ]),
    action("home.alerts", "today.hint.alerts", "/avvisi", false, ["alerts"]),
    TICKETS,
    action("home.payables", "today.hint.payables", "/pagamenti", false, [
      "payablesOverdue",
      "payablesUnpaid",
    ]),
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
    action("nav.invoices", "today.hint.invoices", "/fatture", false, ["invoicesToReview"]),
  ],
  // The chef's list has no money word and no link to a page with amounts.
  chef: [
    action("today.newProduction", "today.hint.newProduction", "/produzione/nuova", true, [
      "batchesUseBy",
    ]),
    TICKETS,
    action("today.prep", "today.hint.prep", "/avvisi", false, ["alerts"]),
    action("today.dailyCount", "today.hint.dailyCount", "/magazzino/conteggi", false, [
      "countOpen",
    ]),
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

export type BadgeKind = "neutral" | "info" | "warning" | "success" | "danger";

export interface TodayBadge {
  labelKey: MessageKey;
  /** The number for the label's {count}; null for words without one. */
  count: number | null;
  tone: BadgeKind;
}

const BADGE: Record<CardKey, { labelKey: MessageKey; tone: BadgeKind; counted: boolean }> = {
  alerts: { labelKey: "today.badge.alerts", tone: "warning", counted: true },
  invoicesToReview: { labelKey: "today.badge.invoicesToReview", tone: "warning", counted: true },
  payablesOverdue: { labelKey: "today.badge.payablesOverdue", tone: "danger", counted: true },
  payablesUnpaid: { labelKey: "today.badge.payablesUnpaid", tone: "info", counted: true },
  batchesUseBy: { labelKey: "today.badge.batchesUseBy", tone: "warning", counted: true },
  countOpen: { labelKey: "today.badge.countOpen", tone: "info", counted: false },
};

/**
 * The state of one action: its most urgent card with a count, else "Niente da fare". Null when the action has no card
 * or the payload holds none of its cards (still loading, failed, or another role's payload).
 */
export function badgeFor(action: TodayAction, cards: readonly TodayCard[]): TodayBadge | null {
  const present = (action.cards ?? []).flatMap((key) => cards.filter((c) => c.key === key));
  if (present.length === 0) return null;
  const urgent = present.find((c) => c.count > 0);
  if (!urgent) return { labelKey: "today.badge.none", count: null, tone: "neutral" };
  const kind = BADGE[urgent.key];
  const labelKey =
    urgent.key === "alerts" && urgent.more ? "today.badge.alertsMore" : kind.labelKey;
  return { labelKey, count: kind.counted ? urgent.count : null, tone: kind.tone };
}

export interface StepStatus extends FirstStep {
  /** Null when the server list is not there (loading, failed): the step is shown with no state. */
  done: boolean | null;
}

// Each step is done when all its server keys are.
const STEP_KEYS: Record<string, readonly SetupKey[]> = {
  "/anagrafiche/ubicazioni": ["locations"],
  "/anagrafiche/fornitori": ["suppliers"],
  "/anagrafiche/ingredienti": ["ingredients"],
  "/fatture": ["invoice"],
  "/personale": ["staff", "device"],
  "/tavoli": ["tables", "menu"],
};

/** "Primi passi" with their state from /api/today. Empty for the chef and the waiter. */
export function stepStatuses(role: string, setup: readonly SetupStep[] | null): StepStatus[] {
  return firstSteps(role).map((step) => {
    if (setup === null) return { ...step, done: null };
    const keys = STEP_KEYS[step.href] ?? [];
    return { ...step, done: keys.every((key) => setup.find((s) => s.key === key)?.done === true) };
  });
}

/** True when there are steps and every one is done: the list is then hidden. */
export const allStepsDone = (steps: readonly StepStatus[]): boolean =>
  steps.length > 0 && steps.every((step) => step.done === true);
