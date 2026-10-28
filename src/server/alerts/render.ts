import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { NO_NAMES, type AlertNames } from "./names";
import { formattersFor, TEMPLATES, type AlertTemplate } from "./templates";

export interface RenderedAlert {
  title: string;
  body: string;
}

/** What rendering needs of a stored alert. */
export interface RenderableAlert {
  id: string;
  kind: string;
  payload: unknown;
}

function fallback(locale: Locale): RenderedAlert {
  return {
    title: t("alerts.fallback.title", {}, locale),
    body: t("alerts.fallback.body", {}, locale),
  };
}

/**
 * Turns a stored alert (a kind and a structured payload) into its title and body in the reader's
 * locale. An unknown kind, or a payload that fails the kind's schema, shows the generic fallback and
 * is reported by alert id and kind only: the report never carries a payload value or a schema
 * message (which can quote one). The registry is a parameter so tests can add a fixture kind. `names`
 * holds the ingredient and location names looked up for this reader (M12); a missing one shows a neutral word.
 */
export function renderAlert(
  alert: RenderableAlert,
  locale: Locale = DEFAULT_LOCALE,
  registry: Readonly<Record<string, AlertTemplate>> = TEMPLATES,
  names: AlertNames = NO_NAMES,
): RenderedAlert {
  const template = Object.hasOwn(registry, alert.kind) ? registry[alert.kind] : undefined;
  if (!template) {
    reportError(new Error(`Alert ${alert.id}: unknown kind ${kindForReport(alert.kind)}`));
    return fallback(locale);
  }
  const parsed = template.payload.safeParse(alert.payload);
  if (!parsed.success) {
    // M19: a kind may have more than one payload shape; the first variant that accepts the payload renders it.
    for (const variant of template.variants ?? []) {
      const alt = variant.payload.safeParse(alert.payload);
      if (alt.success) {
        const values = variant.params(alt.data, formattersFor(locale), names);
        const bodyKey = variant.bodyKeyFor ? variant.bodyKeyFor(alt.data) : variant.bodyKey;
        return { title: t(variant.titleKey, values, locale), body: t(bodyKey, values, locale) };
      }
    }
    reportError(
      new Error(`Alert ${alert.id}: invalid payload for kind ${kindForReport(alert.kind)}`),
    );
    return fallback(locale);
  }
  const values = template.params(parsed.data, formattersFor(locale), names);
  return {
    title: t(template.titleKey, values, locale),
    body: t(template.bodyKey, values, locale),
  };
}

// A kind comes from the registry-checked database column; the bound keeps a corrupt value short.
const MAX_KIND_CHARS = 41;
const kindForReport = (kind: string) => kind.slice(0, MAX_KIND_CHARS);
