import type { MessageKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { EM_DASH, defaultRange, formatInstant, rangeProblem } from "./console-dates";

/** The ten audit codes of the console log, in the order of the code list, each with its sentence. */
export const AUDIT_SENTENCE_KEYS: Record<string, MessageKey> = {
  "platform_admin.bootstrapped": "console.audit.action.platform_admin.bootstrapped",
  "platform_admin.factor_enrolled": "console.audit.action.platform_admin.factor_enrolled",
  "console.entered": "console.audit.action.console.entered",
  "console.left": "console.audit.action.console.left",
  "console.tenant_opened": "console.audit.action.console.tenant_opened",
  "notice.created": "console.audit.action.notice.created",
  "notice.tenant_notified": "console.audit.action.notice.tenant_notified",
  "script.create_tenant": "console.audit.action.script.create_tenant",
  "script.mfa_reset": "console.audit.action.script.mfa_reset",
  "script.set_mfa_enforcement": "console.audit.action.script.set_mfa_enforcement",
};

/** The sentence for a code, or null when the code is not known (the screen then shows the code itself). */
export function auditSentence(action: string): string | null {
  if (!Object.hasOwn(AUDIT_SENTENCE_KEYS, action)) return null;
  return t(AUDIT_SENTENCE_KEYS[action]!);
}

export function originLabel(origin: string): string {
  if (origin === "console") return t("console.audit.origin.console");
  if (origin === "script") return t("console.audit.origin.script");
  return origin;
}

/** The venue's name; a dash for a platform-wide row; "Locale cancellato" and the id's first 8 characters for an erased venue. */
export function auditPlace(row: { tenantId: string | null; tenantName: string | null }): string {
  if (row.tenantName !== null) return row.tenantName;
  if (row.tenantId === null) return EM_DASH;
  return `${t("console.audit.erasedPlace")} ${row.tenantId.slice(0, 8)}`;
}

export function auditDetailEntries(
  detail: Record<string, string | number | boolean | null>,
): [string, string][] {
  return Object.keys(detail)
    .sort()
    .map((key) => {
      const value = detail[key];
      return [key, value === null || value === undefined ? EM_DASH : String(value)];
    });
}

export interface RegistroQuery {
  dal: string;
  al: string;
  locale: string | null;
  azione: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads the Registro's filters from the address. Anything missing or invalid falls back to the default range or no filter. */
export function parseRegistroQuery(
  params: URLSearchParams,
  today: string,
  knownActions: readonly string[],
): RegistroQuery {
  const dal = params.get("dal");
  const al = params.get("al");
  const range =
    dal !== null && al !== null && rangeProblem(dal, al) === null
      ? { dal, al }
      : defaultRange(today);
  const locale = params.get("locale");
  const azione = params.get("azione");
  return {
    ...range,
    locale: locale !== null && UUID.test(locale) ? locale : null,
    azione: azione !== null && knownActions.includes(azione) ? azione : null,
  };
}

/** The visible address for the filters; the dates are left out when they are the default range. */
export function registroHref(q: RegistroQuery, today: string): string {
  const params = new URLSearchParams();
  const def = defaultRange(today);
  if (q.dal !== def.dal || q.al !== def.al) {
    params.set("dal", q.dal);
    params.set("al", q.al);
  }
  if (q.locale !== null) params.set("locale", q.locale);
  if (q.azione !== null) params.set("azione", q.azione);
  const text = params.toString();
  return text === "" ? "/registro" : `/registro?${text}`;
}

/** The API path for one page: dal and al always, the other filters only when set. */
export function auditRequestPath(q: RegistroQuery, prima: number | null): string {
  const params = new URLSearchParams({ dal: q.dal, al: q.al });
  if (q.locale !== null) params.set("locale", q.locale);
  if (q.azione !== null) params.set("azione", q.azione);
  if (prima !== null) {
    if (!Number.isInteger(prima))
      throw new RangeError("auditRequestPath: prima must be an integer");
    params.set("prima", String(prima));
  }
  return `/api/platform/audit?${params.toString()}`;
}

/** The phone list's second line: "14 nov 2026, 09:40 · Osteria Demo A · Console". */
export function auditListMeta(row: {
  at: string;
  tenantId: string | null;
  tenantName: string | null;
  origin: string;
}): string {
  return [formatInstant(row.at), auditPlace(row), originLabel(row.origin)].join(" · ");
}
