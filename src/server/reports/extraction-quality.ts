import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { addDays, daysInclusive, venueDate } from "@/lib/time/venue-date";
import { mapReviewError } from "@/server/invoices/review-errors";

/** The longest period one report may cover (mirrors `range_too_long` in the database). */
export const MAX_REPORT_DAYS = 366;
/** The default period: this many days, today included. */
export const DEFAULT_REPORT_DAYS = 30;

export const REPORT_STATUSES = ["all", "approved"] as const;

const reportQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  supplierId: z.uuid().optional(),
  status: z.enum(REPORT_STATUSES).default("all"),
});

export interface ExtractionQualityQuery {
  from: string;
  to: string;
  supplierId: string | null;
  status: (typeof REPORT_STATUSES)[number];
}

const invalid = (message: string) => new ApiError(400, "invalid_request", message);

/**
 * Reads `from`, `to` (ISO dates), `supplierId` and `status` from a URL. The period defaults to
 * the last 30 days ending today in Europe/Rome; a missing bound is derived from the other. The
 * clock is a parameter so tests can fix it.
 */
export function parseExtractionQualityQuery(url: URL, now: Date): ExtractionQualityQuery {
  const parsed = reportQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw invalid(`Filtri non validi: ${fields.join(", ")}`);
  }
  const { from: givenFrom, to: givenTo, supplierId, status } = parsed.data;
  const to = givenTo ?? venueDate(now);
  const from = givenFrom ?? addDays(to, 1 - DEFAULT_REPORT_DAYS);
  const days = daysInclusive(from, to);
  if (days === 0) throw invalid("La data iniziale deve essere precedente a quella finale.");
  if (days > MAX_REPORT_DAYS) {
    throw invalid(`Il periodo può durare al massimo ${MAX_REPORT_DAYS} giorni.`);
  }
  return { from, to, supplierId: supplierId ?? null, status };
}

/** The report as `public.extraction_quality` returns it (camelCase), passed through untouched. */
export async function getExtractionQuality(
  supabase: SupabaseClient,
  query: ExtractionQualityQuery,
): Promise<unknown> {
  const { data, error } = await supabase.rpc("extraction_quality", {
    p_from: query.from,
    p_to: query.to,
    p_supplier: query.supplierId,
    p_status: query.status,
  });
  if (error) throw mapReviewError(error);
  return data;
}

/** What `public.extraction_quality` returns (plan §3.2); the quality screen renders it as it is. */
export interface ExtractionQualityReport {
  invoices?: number;
  lines: number;
  correctedLines: number;
  correctionRate: number | null;
  autoMappedLines: number;
  autoMappedCorrected: number;
  autoMappedCorrectionRate: number | null;
  manualMappedLines: number;
  splitLines: number;
  byField: Record<string, number>;
  bySupplier: {
    supplierId: string;
    name: string;
    lines: number;
    correctedLines: number;
    correctionRate: number | null;
  }[];
}
