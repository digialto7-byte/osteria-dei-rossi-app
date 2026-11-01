import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { addDays, venueDate } from "@/lib/time/venue-date";
import { getAvtReport } from "@/server/reports/avt";
import { getKpiReport } from "@/server/reports/kpis";
import type { AvtOutput } from "@/server/reports/output";
import { parseCursor } from "@/server/counts/schemas";
import { listCounts } from "@/server/counts/sessions";
import { parseReport } from "@/server/reports/run";
import { getWasteCosts } from "@/server/stock/waste-costs";
import { monthlyPackOutput, type MonthlyPack } from "./pack-output";
import type { MonthlyPackQuery } from "./schemas";

// The monthly pack (plan §3.1.7, §3.1.8; Q172-Q175): the KPI, waste and AVT services composed for one month. No SQL here and no arithmetic on money:
// every date comes from the KPI reply (SQL business dates), and the choice of the count is a selection, not a computation.

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

type Variance = MonthlyPack["variance"];

/** The count answers of avt_report that mean "nothing to show" rather than "something broke". */
function varianceStateOf(error: unknown): Variance {
  if (error instanceof ApiError) {
    if (error.status === 404 && error.code === "not_found") return { state: "noCount" };
    if (error.code === "avt_no_opening_count") return { state: "noOpening" };
  }
  throw error;
}

const MAX_COUNT_PAGES = 10;

/**
 * Whether a monthly count was closed on a calendar day of the month (Europe/Rome). Asked only when avt_report says the latest count has no opening
 * count: that answer carries no dates, and "the previous count is missing" is only true for a month that has a count (review fix).
 */
async function monthHasClosedCount(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<boolean> {
  let before = null;
  for (let page = 0; page < MAX_COUNT_PAGES; page += 1) {
    const { sessions, nextCursor } = await listCounts(supabase, { status: "closed", before });
    for (const count of sessions) {
      if (count.type !== "monthly" || count.status !== "closed" || count.closedAt === null)
        continue;
      const day = venueDate(new Date(count.closedAt));
      if (day >= from && day <= to) return true;
    }
    before = nextCursor === null ? null : parseCursor(nextCursor);
    if (before === null) return false;
  }
  return false;
}

/**
 * Which AVT goes in a month's pack (Q175): the latest count closed on a calendar day of the month in Europe/Rome. The latest count overall is asked
 * first; when it belongs to another month, one more call fetches the right one from `availableCounts`. No count in the month: noCount.
 */
async function varianceFor(supabase: SupabaseClient, from: string, to: string): Promise<Variance> {
  let latest: AvtOutput;
  try {
    latest = await getAvtReport(supabase, {});
  } catch (error) {
    if (error instanceof ApiError && error.code === "avt_no_opening_count") {
      return (await monthHasClosedCount(supabase, from, to))
        ? { state: "noOpening" }
        : { state: "noCount" };
    }
    return varianceStateOf(error);
  }
  const inMonth = (closedAt: string) => {
    const day = venueDate(new Date(closedAt));
    return day >= from && day <= to;
  };
  const known = [latest.count, ...latest.availableCounts];
  const pick = known
    .filter((c) => inMonth(c.closedAt))
    .reduce<(typeof known)[number] | null>(
      (best, c) => (best === null || Date.parse(c.closedAt) > Date.parse(best.closedAt) ? c : best),
      null,
    );
  if (pick === null) return { state: "noCount" };
  if (pick.id === latest.count.id) return { state: "ok", avt: latest };
  try {
    return { state: "ok", avt: await getAvtReport(supabase, { count: pick.id }) };
  } catch (error) {
    return varianceStateOf(error);
  }
}

export async function getMonthlyPack(
  supabase: SupabaseClient,
  query: MonthlyPackQuery,
): Promise<MonthlyPack> {
  const kpis = await getKpiReport(supabase, {
    period: "month",
    ...(query.month ? { date: `${query.month}-01` } : {}),
  });
  const { from, to, final } = kpis.current;
  const [waste, variance] = await Promise.all([
    getWasteCosts(supabase, { from, to }),
    varianceFor(supabase, from, to),
  ]);
  return parseReport("monthly_pack", monthlyPackOutput, {
    month: monthOf(from),
    from,
    to,
    final,
    previousMonth: monthOf(kpis.previous.from),
    nextMonth: final ? monthOf(addDays(to, 1)) : null,
    kpis,
    waste,
    variance,
  });
}
