import { t, type MessageKey } from "@/lib/i18n";
import {
  GROUP_NAME_MAX,
  GROUP_SEATS_MAX,
  GROUP_SEATS_MIN,
  GROUP_TABLES_MAX,
  GROUP_TABLES_MIN,
  PRIVACY_EMAIL_MAX,
  PRIVACY_NAME_MAX,
  PRIVACY_NAME_MIN,
  RESERVATION_LIMIT_MAX,
  SETTINGS_RANGES,
  SLOT_MINUTES,
  SLUG_PATTERN,
  TABLE_SEATS_MAX,
  TABLE_SEATS_MIN,
  TIME_PATTERN,
  VENUE_PHONE_PATTERN,
  type SettingsInvalidReason,
} from "@/server/reservations/constants";
import type { ReservationSettings, TableBooking } from "@/server/reservations/output";
import type {
  ReservationSettingsBody,
  TableBookingBody,
  TableGroupBody,
} from "@/server/reservations/schemas";

// Presentation helpers of the reservation settings cards. They only word and compare what the API sent: the draft holds what the owner typed as text, the body that
// goes back holds the fields that differ from the reply and nothing else. No arithmetic on a number of the reply. The server stays the authority on every bound.

export interface ServiceDraft {
  key: string;
  name: string;
  online: boolean;
  firstSeating: string;
  lastSeating: string;
  coversPerSlot: string;
  reservationsPerSlot: string;
  coversPerService: string;
}

export interface SettingsDraft {
  enabled: boolean;
  publicSlug: string;
  venuePhone: string;
  slotMinutes: string;
  stayMinutes: string;
  leadMinutes: string;
  horizonDays: string;
  maxPartyOnline: string;
  cancelUntilMinutes: string;
  retentionDays: string;
  closedWeekdays: number[];
  closedDates: string[];
  services: ServiceDraft[];
  privacyControllerName: string;
  privacyContactEmail: string;
}

type NumberKey =
  | "slotMinutes"
  | "stayMinutes"
  | "leadMinutes"
  | "horizonDays"
  | "maxPartyOnline"
  | "cancelUntilMinutes"
  | "retentionDays";

/** The whole-number settings in screen order, with the reason code of the server for each. */
export const NUMBER_FIELDS: readonly {
  key: NumberKey;
  reason: SettingsInvalidReason;
  label: MessageKey;
}[] = [
  { key: "slotMinutes", reason: "slot_minutes", label: "reservations.slotMinutes" },
  { key: "stayMinutes", reason: "stay_minutes", label: "reservations.stayMinutes" },
  { key: "leadMinutes", reason: "lead_minutes", label: "reservations.leadMinutes" },
  { key: "horizonDays", reason: "horizon_days", label: "reservations.horizonDays" },
  { key: "maxPartyOnline", reason: "max_party_online", label: "reservations.maxPartyOnline" },
  {
    key: "cancelUntilMinutes",
    reason: "cancel_until_minutes",
    label: "reservations.cancelUntilMinutes",
  },
  { key: "retentionDays", reason: "retention_days", label: "reservations.retentionDays" },
];

const RANGE_OF: Record<Exclude<NumberKey, "slotMinutes">, { min: number; max: number }> = {
  stayMinutes: SETTINGS_RANGES.stayMinutes,
  leadMinutes: SETTINGS_RANGES.leadMinutes,
  horizonDays: SETTINGS_RANGES.horizonDays,
  maxPartyOnline: SETTINGS_RANGES.maxPartyOnline,
  cancelUntilMinutes: SETTINGS_RANGES.cancelUntilMinutes,
  retentionDays: SETTINGS_RANGES.retentionDays,
};

/** The values of the "Intervallo" list. */
export const SLOT_CHOICES: readonly string[] = SLOT_MINUTES.map(String);

const text = (value: number | null) => (value === null ? "" : String(value));

export function draftFromSettings(settings: ReservationSettings): SettingsDraft {
  return {
    enabled: settings.enabled,
    publicSlug: settings.publicSlug ?? "",
    venuePhone: settings.venuePhone ?? "",
    slotMinutes: String(settings.slotMinutes),
    stayMinutes: String(settings.stayMinutes),
    leadMinutes: String(settings.leadMinutes),
    horizonDays: String(settings.horizonDays),
    maxPartyOnline: String(settings.maxPartyOnline),
    cancelUntilMinutes: String(settings.cancelUntilMinutes),
    retentionDays: String(settings.retentionDays),
    closedWeekdays: [...settings.closedWeekdays],
    closedDates: [...settings.closedDates],
    services: settings.services.map((s) => ({
      key: s.key,
      name: s.name,
      online: s.online,
      firstSeating: s.firstSeating ?? "",
      lastSeating: s.lastSeating ?? "",
      coversPerSlot: text(s.coversPerSlot),
      reservationsPerSlot: text(s.reservationsPerSlot),
      coversPerService: text(s.coversPerService),
    })),
    privacyControllerName: settings.privacy.controllerName ?? "",
    privacyContactEmail: settings.privacy.contactEmail ?? "",
  };
}

export type BodyResult =
  { ok: true; body: ReservationSettingsBody } | { ok: false; reason: SettingsInvalidReason };

/** A whole number typed as digits, or null. */
function whole(value: string): number | null {
  const trimmed = value.trim();
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : null;
}

const sameList = (a: readonly (string | number)[], b: readonly (string | number)[]) =>
  a.join(",") === b.join(",");

/** A limit typed as digits: "" is no limit (null), else 1 to 999; undefined when it is not valid. */
function limit(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = whole(trimmed);
  return n !== null && n >= 1 && n <= RESERVATION_LIMIT_MAX ? n : undefined;
}

function servicesChanged(settings: ReservationSettings, draft: ServiceDraft[]): boolean {
  return settings.services.some((s, i) => {
    const d = draft[i];
    return (
      d === undefined ||
      d.online !== s.online ||
      d.firstSeating !== (s.firstSeating ?? "") ||
      d.lastSeating !== (s.lastSeating ?? "") ||
      d.coversPerSlot.trim() !== text(s.coversPerSlot) ||
      d.reservationsPerSlot.trim() !== text(s.reservationsPerSlot) ||
      d.coversPerService.trim() !== text(s.coversPerService)
    );
  });
}

/**
 * What to send for the edited draft: the fields that differ from the reply, each checked against the server's bounds (the server checks again). A text field that
 * is emptied clears the setting (null). The first invalid field is named by its server reason code, so the card shows the server's own sentence for it.
 */
export function settingsBody(settings: ReservationSettings, draft: SettingsDraft): BodyResult {
  const body: ReservationSettingsBody = {};
  const bad = (reason: SettingsInvalidReason): BodyResult => ({ ok: false, reason });

  if (draft.enabled !== settings.enabled) body.enabled = draft.enabled;

  const slug = draft.publicSlug.trim();
  if (slug !== (settings.publicSlug ?? "")) {
    if (slug === "") body.publicSlug = null;
    else if (SLUG_PATTERN.test(slug)) body.publicSlug = slug;
    else return bad("public_slug");
  }
  const phone = draft.venuePhone.trim();
  if (phone !== (settings.venuePhone ?? "")) {
    if (phone === "") body.venuePhone = null;
    else if (VENUE_PHONE_PATTERN.test(phone)) body.venuePhone = phone;
    else return bad("venue_phone");
  }

  for (const field of NUMBER_FIELDS) {
    if (draft[field.key].trim() === String(settings[field.key])) continue;
    const n = whole(draft[field.key]);
    if (field.key === "slotMinutes") {
      if (n === null || !(SLOT_MINUTES as readonly number[]).includes(n)) return bad(field.reason);
    } else {
      const range = RANGE_OF[field.key];
      if (n === null || n < range.min || n > range.max) return bad(field.reason);
    }
    body[field.key] = n;
  }

  if (!sameList(draft.closedWeekdays, settings.closedWeekdays)) {
    body.closedWeekdays = [...draft.closedWeekdays];
  }
  if (!sameList(draft.closedDates, settings.closedDates)) {
    body.closedDates = [...draft.closedDates];
  }

  if (servicesChanged(settings, draft.services)) {
    const services: NonNullable<ReservationSettingsBody["services"]> = [];
    for (const d of draft.services) {
      const first = d.firstSeating.trim();
      const last = d.lastSeating.trim();
      const both = first === "" && last === "";
      const times = TIME_PATTERN.test(first) && TIME_PATTERN.test(last) && first <= last;
      const limits = [
        limit(d.coversPerSlot),
        limit(d.reservationsPerSlot),
        limit(d.coversPerService),
      ];
      if ((!both && !times) || limits.includes(undefined)) return bad("services");
      services.push({
        key: d.key,
        online: d.online,
        firstSeating: both ? null : first,
        lastSeating: both ? null : last,
        coversPerSlot: limits[0]!,
        reservationsPerSlot: limits[1]!,
        coversPerService: limits[2]!,
      });
    }
    body.services = services;
  }

  const name = draft.privacyControllerName.trim();
  if (name !== (settings.privacy.controllerName ?? "")) {
    if (name === "") body.privacyControllerName = null;
    else if (name.length >= PRIVACY_NAME_MIN && name.length <= PRIVACY_NAME_MAX) {
      body.privacyControllerName = name;
    } else return bad("privacy_controller_name");
  }
  const email = draft.privacyContactEmail.trim();
  if (email !== (settings.privacy.contactEmail ?? "")) {
    if (email === "") body.privacyContactEmail = null;
    else if (email.length <= PRIVACY_EMAIL_MAX && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      body.privacyContactEmail = email;
    } else return bad("privacy_contact_email");
  }
  return { ok: true, body };
}

/** "<origin>/prenota/<slug>" for a well-formed slug, else null (the card shows its hint instead). */
export function slugPreview(origin: string, slug: string): string | null {
  const trimmed = slug.trim();
  return SLUG_PATTERN.test(trimmed) ? `${origin}/prenota/${trimmed}` : null;
}

/** Monday is 1 and Sunday is 7, as the database counts. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const weekdayLabel = (day: number): string => t(`reservations.weekday.${day}` as MessageKey);

/** The sorted list after a weekday is ticked or unticked. */
export function toggleWeekday(days: readonly number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
}

/** The sorted list after a date is added (once) or taken out. */
export const addDate = (dates: readonly string[], date: string): string[] =>
  dates.includes(date) ? [...dates] : [...dates, date].sort();
export const removeDate = (dates: readonly string[], date: string): string[] =>
  dates.filter((d) => d !== date);

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Bookable tables and groups

export interface BookingDraftRow {
  tableId: string;
  bookable: boolean;
  seats: string;
}

export const draftFromBooking = (booking: TableBooking): BookingDraftRow[] =>
  booking.tables.map((row) => ({
    tableId: row.tableId,
    bookable: row.bookable,
    seats: text(row.seats),
  }));

export type BookingResult = { ok: true; tables: TableBookingBody["tables"] } | { ok: false };

/** The tables whose switch or seats differ from the reply, in the body the API takes. Seats empty is null; seats outside 1 to 40 are not valid. */
export function tableBookingChanges(
  booking: TableBooking,
  draft: BookingDraftRow[],
): BookingResult {
  const tables: TableBookingBody["tables"] = [];
  for (const row of draft) {
    const current = booking.tables.find((x) => x.tableId === row.tableId);
    if (!current) continue;
    const seatsText = row.seats.trim();
    if (row.bookable === current.bookable && seatsText === text(current.seats)) continue;
    let seats: number | null = null;
    if (seatsText !== "") {
      const n = whole(seatsText);
      if (n === null || n < TABLE_SEATS_MIN || n > TABLE_SEATS_MAX) return { ok: false };
      seats = n;
    }
    tables.push({ tableId: row.tableId, bookable: row.bookable, seats });
  }
  return { ok: true, tables };
}

export type GroupResult =
  { ok: true; body: TableGroupBody } | { ok: false; reason: "name" | "seats" | "tables" };

/** The new group as the API takes it, or the server's reason code for the first field that is wrong. */
export function newGroupBody(name: string, seats: string, tableIds: string[]): GroupResult {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > GROUP_NAME_MAX) return { ok: false, reason: "name" };
  const n = whole(seats);
  if (n === null || n < GROUP_SEATS_MIN || n > GROUP_SEATS_MAX)
    return { ok: false, reason: "seats" };
  if (tableIds.length < GROUP_TABLES_MIN || tableIds.length > GROUP_TABLES_MAX) {
    return { ok: false, reason: "tables" };
  }
  return { ok: true, body: { name: trimmed, seats: n, tableIds } };
}
