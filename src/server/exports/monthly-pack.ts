import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { addDays, venueDate } from "@/lib/time/venue-date";
import { getAvtReport } from "@/server/reports/avt";
import { getKpiReport } from "@/server/reports/kpis";
import type { AvtOutput } from "@/server/reports/output";
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

/**
 * Which AVT goes in a month's pack (Q175): the latest count closed on a calendar day of the month in Europe/Rome. The latest count overall is asked
 * first; when it belongs to another month, one more call fetches the right one from `availableCounts`. No count in the month: noCount.
 */
async function varianceFor(supabase: SupabaseClient, from: string, to: string): Promise<Variance> {
  let latest: AvtOutput;
  try {
    latest = await getAvtReport(supabase, {});
  } catch (error) {
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
