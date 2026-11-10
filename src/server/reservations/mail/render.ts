import { z } from "zod";
import { INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { t, tn } from "@/lib/i18n";
import { signCancelToken, type LinkKeys } from "../public/tokens";
import { htmlMail, textMail, type MailParts } from "./templates";

/** One row of `reservation_mail_claim`, strictly parsed: a key the schema does not know is a failure and never part of an e-mail. */
export const claimedMail = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["received", "accepted", "declined"]),
  to: z.string().min(3),
  locale: z.enum(["it", "en"]),
  name: z.string(),
  venueName: z.string(),
  slug: z.string().nullable(),
  reservationId: z.uuid(),
  /** The venue's local date and time, already (the database converts them with the tenant's time zone). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  party: z.number().int(),
  serviceName: z.string(),
  cancelExp: z.number().int().nullable(),
});
export type ClaimedMail = z.infer<typeof claimedMail>;
export const claimedMails = z.array(claimedMail);

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

/** "ven 20 novembre 2026, 20:00": the date is a calendar date in the venue's zone, so it is read at noon, which no zone moves to another day. */
function whenLabel(date: string, time: string, locale: Locale): string {
  const day = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(new Date(`${date}T12:00:00Z`));
  return `${day}, ${time}`;
}

/**
 * Renders one outbox row. `received` and `accepted` carry the cancel link `<origin>/prenota/<slug>/annulla?t=<token>` when the page has a slug and the row has an
 * expiry; `declined` never does. There is no price and no table anywhere in the text.
 */
export function renderReservationMail(
  row: ClaimedMail,
  context: { origin: string; keys: LinkKeys },
): RenderedMail {
  const { locale, kind } = row;
  const venue = row.venueName;
  const cancelUrl =
    kind !== "declined" && row.slug !== null && row.cancelExp !== null
      ? `${context.origin}/prenota/${row.slug}/annulla?t=${signCancelToken(context.keys, row.reservationId, row.cancelExp)}`
      : null;
  const parts: MailParts = {
    lead: t(`reservationMail.${kind}.lead`, { name: row.name }, locale),
    status: t(`reservationMail.${kind}.status`, {}, locale),
    details: [
      [t("reservationMail.when", {}, locale), whenLabel(row.date, row.time, locale)],
      [t("reservationMail.people", {}, locale), tn("reservationMail.party", row.party, locale)],
      [t("reservationMail.service", {}, locale), row.serviceName],
    ],
    cancel: cancelUrl
      ? {
          lead: t("reservationMail.cancel.lead", {}, locale),
          label: t("reservationMail.cancel.button", {}, locale),
          url: cancelUrl,
        }
      : null,
    footer: t("reservationMail.footer", { venue }, locale),
  };
  return {
    // A line break in a venue name must not become a header.
    subject: t(`reservationMail.${kind}.subject`, { venue }, locale).replace(/[\r\n]+/g, " "),
    text: textMail(parts),
    html: htmlMail(parts, locale),
  };
}
