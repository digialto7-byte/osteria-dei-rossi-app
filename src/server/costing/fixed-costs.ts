import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { unwrapCost } from "./errors";
import type { fixedCostBody } from "./schemas";
import type { FixedCostEntry, FixedCostPeriod } from "./types";

// Fixed costs are owner only, read and write (founder 2026-10-23). Monthly totals, never per person.

export interface FixedCostRow {
  id: string;
  month: string;
  rent: number;
  labour: number;
  utilities: number;
  created_at: string;
}

const cents = (...amounts: number[]) =>
  amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100;

/**
 * Newest month first; inside a month the newest entry first. That one is in force, the older ones
 * are marked superseded (a correction is a new entry, nothing is overwritten).
 */
export function buildFixedCostPeriods(rows: readonly FixedCostRow[]): FixedCostPeriod[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.month.localeCompare(a.month) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id.localeCompare(a.id),
  );
  const seen = new Set<string>();
  return sorted.map((row) => {
    const inForce = !seen.has(row.month);
    seen.add(row.month);
    return {
      id: row.id,
      month: row.month,
      rentEur: row.rent,
      labourEur: row.labour,
      utilitiesEur: row.utilities,
      totalEur: cents(row.rent, row.labour, row.utilities),
      createdAt: row.created_at,
      inForce,
      superseded: !inForce,
    };
  });
}

export async function listFixedCosts(
  supabase: SupabaseClient,
): Promise<{ periods: FixedCostPeriod[] }> {
  const rows =
    unwrapCost<FixedCostRow[] | null>(
      await supabase
        .from("fixed_cost_period")
        .select("id, month, rent, labour, utilities, created_at")
        .order("month", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(240),
    ) ?? [];
  return { periods: buildFixedCostPeriods(rows) };
}

interface Entered {
  id: string;
  month: string;
  rent: number;
  labour: number;
  utilities: number;
  total: number;
}

/**
 * Enters (or corrects) a month. `created` is false when the figures repeated the month's newest
 * entry (a double tap): the database then returns that entry and writes nothing.
 */
export async function enterFixedCosts(
  supabase: SupabaseClient,
  body: z.infer<typeof fixedCostBody>,
): Promise<{ created: boolean; period: FixedCostEntry }> {
  const month = `${body.month}-01`;
  const before = unwrapCost<{ id: string } | null>(
    await supabase
      .from("fixed_cost_period")
      .select("id")
      .eq("month", month)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  const data = unwrapCost<Entered>(
    await supabase.rpc("enter_fixed_costs", {
      p_month: month,
      p_rent: body.rentEur,
      p_labour: body.labourEur,
      p_utilities: body.utilitiesEur,
    }),
  );
  return {
    created: before?.id !== data.id,
    period: {
      id: data.id,
      month: data.month,
      rentEur: data.rent,
      labourEur: data.labour,
      utilitiesEur: data.utilities,
      totalEur: data.total,
    },
  };
}
