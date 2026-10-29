import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { AppRole } from "@/lib/api/with-api";
import { reportError } from "@/lib/observability/report";
import { visibleTo, type AlertRow } from "@/server/alerts/list";
import { TODAY_ALERT_CAP } from "./constants";
import {
  chefCountsSchema,
  type ChefCounts,
  managerCountsSchema,
  type ManagerCounts,
  type SetupStep,
  type TodayCard,
  type TodaySummary,
} from "./types";

const unavailable = () =>
  new ApiError(
    500,
    "today_unavailable",
    "Il riepilogo di oggi non è disponibile. Riprova tra poco.",
  );

// Where each card leads. Counts only; the screens behind the invoice and payable cards are owner and admin screens.
const HREF = {
  alerts: "/avvisi",
  invoicesToReview: "/fatture",
  payablesOverdue: "/pagamenti",
  payablesUnpaid: "/pagamenti",
  batchesUseBy: "/produzione",
  countOpen: "/magazzino/conteggi",
} as const;

const card = (key: keyof typeof HREF, count: number, more = false): TodayCard => ({
  key,
  count,
  more,
  href: HREF[key],
});

function setupSteps(s: ManagerCounts["setup"]): SetupStep[] {
  return [
    { key: "locations", done: s.hasLocations, href: "/anagrafiche/ubicazioni" },
    { key: "suppliers", done: s.hasSuppliers, href: "/anagrafiche/fornitori" },
    { key: "ingredients", done: s.hasIngredients, href: "/anagrafiche/ingredienti" },
    { key: "invoice", done: s.hasApprovedInvoice, href: "/fatture" },
    { key: "staff", done: s.hasStaff, href: "/personale" },
    { key: "device", done: s.hasDevice, href: "/dispositivi" },
    { key: "tables", done: s.hasTables, href: "/tavoli/impostazioni" },
    { key: "menu", done: s.hasMenuItems, href: "/menu" },
  ];
}

/**
 * The open alerts the caller sees, read the way /avvisi reads them (open, newest first, the same visibleTo filter) and
 * capped, so the number cannot drift from the list. At most TODAY_ALERT_CAP + 1 rows are read.
 */
async function countAlerts(supabase: SupabaseClient, role: AppRole): Promise<TodayCard> {
  const { data, error } = await supabase
    .from("alert")
    .select("id, cost_bearing")
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TODAY_ALERT_CAP + 1);
  if (error) {
    reportError(new Error(`today alerts failed: ${error.code ?? "no_code"}`));
    throw unavailable();
  }
  const rows = (data ?? []) as unknown as Pick<AlertRow, "cost_bearing">[];
  const shown = rows.slice(0, TODAY_ALERT_CAP).filter(visibleTo(role));
  return card("alerts", shown.length, rows.length > TODAY_ALERT_CAP);
}

/** The alerts card from a count the caller already has (the dashboard's SQL counts them in the same call). */
export const alertsCard = (count: number, more: boolean): TodayCard => card("alerts", count, more);

/**
 * Pure: the cards and the set-up list from the counts of public.today_counts(). `alerts` is the alerts card of a role
 * that reads alerts (owner, chef) and null for the admin, who has none.
 */
export function buildTodaySummary(
  counts: ChefCounts | ManagerCounts,
  alerts: TodayCard | null,
  role: AppRole,
): TodaySummary {
  if (role === "chef") {
    return {
      cards: [
        ...(alerts ? [alerts] : []),
        card("batchesUseBy", counts.batchesUseBy),
        card("countOpen", counts.countOpen ? 1 : 0),
      ],
      setup: null,
    };
  }
  const c = counts as ManagerCounts;
  const cards = [
    card("invoicesToReview", c.invoicesToReview),
    card("payablesOverdue", c.payablesOverdue),
    card("payablesUnpaid", c.payablesUnpaid),
    card("batchesUseBy", c.batchesUseBy),
    card("countOpen", c.countOpen ? 1 : 0),
  ];
  // Alerts are for the owner and the chef only (founder, 2026-10-28); the admin has no alerts card.
  if (alerts && role === "owner") cards.unshift(alerts);
  return { cards, setup: setupSteps(c.setup) };
}

/** The cards and the set-up list of "Oggi" for one role. The waiter never gets here (the route refuses them). */
export async function todaySummary(supabase: SupabaseClient, role: AppRole): Promise<TodaySummary> {
  const { data, error } = await supabase.rpc("today_counts");
  if (error) {
    if (error.code === "42501") {
      throw new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    }
    reportError(new Error(`today_counts failed: ${error.code ?? "no_code"}`));
    throw unavailable();
  }

  if (role === "chef") {
    const counts = chefCountsSchema.safeParse(data);
    if (!counts.success) throw unavailable();
    return buildTodaySummary(counts.data, await countAlerts(supabase, role), role);
  }

  const counts = managerCountsSchema.safeParse(data);
  if (!counts.success) throw unavailable();
  return buildTodaySummary(
    counts.data,
    role === "owner" ? await countAlerts(supabase, role) : null,
    role,
  );
}
