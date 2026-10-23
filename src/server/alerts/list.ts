import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import type { AppRole } from "@/lib/api/with-api";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n/locale";
import { ALERT_LIST_PAGE_SIZE } from "./constants";
import { mapAlertError } from "./errors";
import { renderAlert } from "./render";

export const ALERT_FILTERS = ["open", "all"] as const;

/** A stored alert as the list query returns it. The payload and the cost flag stay on the server. */
export interface AlertRow {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  entity_type: string;
  entity_id: string | null;
  business_date: string;
  created_at: string;
  payload: unknown;
  cost_bearing: boolean;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  /** The acknowledger's name; RLS on app_user hides it from a chef unless it is their own. */
  acknowledger: { display_name: string } | null;
}

/** What the API returns for one alert: rendered text, never the raw payload. */
export interface AlertItem {
  id: string;
  kind: string;
  severity: AlertRow["severity"];
  entityType: string;
  entityId: string | null;
  businessDate: string;
  createdAt: string;
  title: string;
  body: string;
  acknowledged: { at: string; byName: string | null } | null;
}

export interface AlertList {
  alerts: AlertItem[];
  nextCursor: string | null;
  canRaiseTest: boolean;
}

export interface AlertCursor {
  createdAt: string;
  id: string;
}

export interface ListAlertsQuery {
  filter: (typeof ALERT_FILTERS)[number];
  before: AlertCursor | null;
  locale: Locale;
}

// The acknowledger join names the foreign key: alert also references app_user through created_by.
export const ALERT_COLUMNS =
  "id, kind, severity, entity_type, entity_id, business_date, created_at, payload, cost_bearing, " +
  "acknowledged_at, acknowledged_by, acknowledger:app_user!alert_acknowledger_fk(display_name)";

const invalid = (message: string) => new ApiError(400, "invalid_request", message);

// `<created_at>_<id>`: an ISO timestamp (no underscore in it) and a uuid. The strict shape also keeps
// anything that could change the PostgREST filter built from it (commas, parentheses) out.
const CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseAlertCursor(text: string): AlertCursor | null {
  const match = CURSOR.exec(text);
  return match ? { createdAt: match[1]!, id: match[2]! } : null;
}

const cursorOf = (row: AlertRow) => `${row.created_at.replace(/\+00:00$/, "Z")}_${row.id}`;

const localeSchema = z.enum(LOCALES);
const listQuery = z.strictObject({
  filter: z.enum(ALERT_FILTERS).default("open"),
  before: z.string().max(80).optional(),
  locale: localeSchema.default(DEFAULT_LOCALE),
});
const localeQuery = z.strictObject({ locale: localeSchema.default(DEFAULT_LOCALE) });

function queryError(error: z.ZodError): ApiError {
  const fields = [
    ...new Set(
      error.issues.flatMap((issue) =>
        issue.code === "unrecognized_keys" ? issue.keys : [issue.path.join(".")],
      ),
    ),
  ];
  return invalid(`Filtri non validi: ${fields.join(", ")}`);
}

/** `?filter=open|all`, `?before=<createdAt>_<id>`, `?locale=it|en`; anything else is a 400. */
export function parseListAlertsQuery(url: URL): ListAlertsQuery {
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw queryError(parsed.error);
  const { filter, before, locale } = parsed.data;
  const cursor = before === undefined ? null : parseAlertCursor(before);
  if (before !== undefined && !cursor) throw invalid("Filtri non validi: before");
  return { filter, before: cursor, locale };
}

/** `?locale=it|en` for the routes that return one item. */
export function parseLocaleQuery(url: URL): Locale {
  const parsed = localeQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw queryError(parsed.error);
  return parsed.data.locale;
}

// Defence in depth (plan §3.6): RLS already keeps cost-bearing rows from the chef.
const visibleTo = (role: AppRole) => (row: AlertRow) => role === "owner" || !row.cost_bearing;

export function toAlertItem(row: AlertRow, locale: Locale): AlertItem {
  const { title, body } = renderAlert(row, locale);
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    entityType: row.entity_type,
    entityId: row.entity_id,
    businessDate: row.business_date,
    createdAt: row.created_at,
    title,
    body,
    acknowledged: row.acknowledged_at
      ? { at: row.acknowledged_at, byName: row.acknowledger?.display_name ?? null }
      : null,
  };
}

/** Pure: one fetched page (at most a page plus one row) into the API answer. */
export function buildAlertList(rows: AlertRow[], role: AppRole, locale: Locale): AlertList {
  const page = rows.slice(0, ALERT_LIST_PAGE_SIZE);
  const hasMore = rows.length > ALERT_LIST_PAGE_SIZE;
  return {
    alerts: page.filter(visibleTo(role)).map((row) => toAlertItem(row, locale)),
    // From the raw page, so a row dropped for the chef never stalls the cursor.
    nextCursor: hasMore ? cursorOf(page[page.length - 1]!) : null,
    canRaiseTest: role === "owner",
  };
}

export async function listAlerts(
  supabase: SupabaseClient,
  role: AppRole,
  query: ListAlertsQuery,
): Promise<AlertList> {
  let request = supabase.from("alert").select(ALERT_COLUMNS);
  if (query.filter === "open") request = request.is("acknowledged_at", null);
  if (query.before) {
    const { createdAt, id } = query.before;
    request = request.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }
  const { data, error } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ALERT_LIST_PAGE_SIZE + 1);
  if (error) throw mapAlertError(error);
  return buildAlertList((data ?? []) as unknown as AlertRow[], role, query.locale);
}

/** One alert the caller can read, rendered; 404 when it is missing or not visible. */
export async function getAlert(
  supabase: SupabaseClient,
  id: string,
  role: AppRole,
  locale: Locale,
): Promise<AlertItem> {
  const { data, error } = await supabase
    .from("alert")
    .select(ALERT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw mapAlertError(error);
  const row = data as unknown as AlertRow | null;
  if (!row || !visibleTo(role)(row)) throw mapAlertError({ code: "P0002", message: "not_found" });
  return toAlertItem(row, locale);
}
