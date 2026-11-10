import { MAX_MENU_BODY_BYTES } from "@/server/menu/constants";

// Constants of the reservation endpoints (reservations plan §3.2, §3.4). They mirror 20261124100000_reservation_core.sql and
// 20261124100200_reservation_settings.sql (tests/parity/reservation-constants.test.ts). The SQL stays the authority; these only turn the obvious
// mistakes into a 400 before any RPC. No amount, cost or price lives here: reservations carry no money.

/** Same 4 KiB ceiling as the menu endpoints. */
export const MAX_RESERVATION_BODY_BYTES = MAX_MENU_BODY_BYTES;

/** reservation_settings.slot_minutes: the booking grid. */
export const SLOT_MINUTES = [15, 30, 60] as const;

/** The whole-number settings and their ranges (the table checks and app.reservation_int in the writer). */
export const SETTINGS_RANGES = {
  stayMinutes: { min: 30, max: 360 },
  leadMinutes: { min: 0, max: 2880 },
  horizonDays: { min: 1, max: 365 },
  maxPartyOnline: { min: 1, max: 40 },
  cancelUntilMinutes: { min: 0, max: 2880 },
  retentionDays: { min: 1, max: 365 },
} as const;

/** reservation_settings.public_slug. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
/** reservation_settings.venue_phone, typed by the owner. */
export const VENUE_PHONE_PATTERN = /^\+?[0-9 ]{6,20}$/;
/** reservation_settings.closed_dates holds at most this many dates. */
export const MAX_CLOSED_DATES = 366;
/** HH:MM, 00:00 to 23:59. */
export const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** A stable service key (the M25c rule). */
export const SERVICE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
/** The three limits of a service are null or 1 to this. */
export const RESERVATION_LIMIT_MAX = 999;
/** Privacy controller name and contact e-mail lengths. */
export const PRIVACY_NAME_MIN = 2;
export const PRIVACY_NAME_MAX = 200;
export const PRIVACY_EMAIL_MAX = 254;

/** dining_table_booking.seats. */
export const TABLE_SEATS_MIN = 1;
export const TABLE_SEATS_MAX = 40;
/** One save of the bookable tables carries 1 to this many tables. */
export const TABLE_BOOKING_MAX_ENTRIES = 200;

/** table_group: name length, seats and the number of member tables. */
export const GROUP_NAME_MAX = 40;
export const GROUP_SEATS_MIN = 2;
export const GROUP_SEATS_MAX = 99;
export const GROUP_TABLES_MIN = 2;
export const GROUP_TABLES_MAX = 8;

/** The DETAIL reasons of P0001 reservation_settings_invalid (the fields, snake_case; codes only). */
export const SETTINGS_INVALID_REASONS = [
  "enabled",
  "public_slug",
  "venue_phone",
  "slot_minutes",
  "stay_minutes",
  "lead_minutes",
  "horizon_days",
  "max_party_online",
  "cancel_until_minutes",
  "retention_days",
  "closed_weekdays",
  "closed_dates",
  "privacy_controller_name",
  "privacy_contact_email",
  "services",
] as const;
export type SettingsInvalidReason = (typeof SETTINGS_INVALID_REASONS)[number];

/** Why a page cannot be switched on yet, in the SQL's order (P0001 reservations_not_ready and `notReady`). */
export const NOT_READY_REASONS = ["slug", "privacy_name", "privacy_email", "seating"] as const;
export type NotReadyReason = (typeof NOT_READY_REASONS)[number];

/** P0001 group_invalid. */
export const GROUP_INVALID_REASONS = ["name", "seats", "tables", "name_taken"] as const;
export type GroupInvalidReason = (typeof GROUP_INVALID_REASONS)[number];

/** P0001 table_booking_invalid. */
export const TABLE_BOOKING_INVALID_REASONS = ["duplicate", "seats"] as const;
export type TableBookingInvalidReason = (typeof TABLE_BOOKING_INVALID_REASONS)[number];

/** The statuses a row can read (the effective one: a pending request past its start reads `expired`). */
export const RESERVATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "expired",
  "arrived",
  "seated",
  "no_show",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** What the caller may do with a row, as the database says (app.reservation_row_json). The buttons are exactly this list. */
export const RESERVATION_ACTIONS = [
  "accept",
  "decline",
  "move",
  "tables",
  "arrived",
  "no_show",
  "seat",
  "split",
  "erase",
] as const;
export type ReservationAction = (typeof RESERVATION_ACTIONS)[number];

/** The DETAIL reasons of P0001 slot_unavailable (app.reservation_slot_reason, and dst_gap of the staff functions). */
export const SLOT_UNAVAILABLE_REASONS = [
  "closed",
  "service",
  "seating",
  "grid",
  "dst_gap",
  "horizon",
  "lead",
  "party",
  "slot_limit",
  "service_limit",
  "no_fit",
] as const;
export type SlotUnavailableReason = (typeof SLOT_UNAVAILABLE_REASONS)[number];

/** The DETAIL reasons of P0001 request_invalid: the field that failed (codes only, never the value). */
export const REQUEST_INVALID_REASONS = [
  "date",
  "time",
  "service",
  "party",
  "name",
  "phone",
  "email",
  "locale",
  "privacy",
] as const;
export type RequestInvalidReason = (typeof REQUEST_INVALID_REASONS)[number];

/** Why staff decline (decline_reservation). */
export const DECLINE_REASONS = ["full", "closed", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/** What staff mark (mark_reservation). */
export const MARKS = ["arrived", "no_show"] as const;
export type Mark = (typeof MARKS)[number];

/** reservation.party and reservation_contact.name. */
export const PARTY_MIN = 1;
export const PARTY_MAX = 99;
export const CONTACT_NAME_MAX = 80;
/** A phone as staff type it (create_staff_reservation); the database keeps the digits. */
export const STAFF_PHONE_PATTERN = /^[0-9 ()+.-]{6,30}$/;
export const CONTACT_EMAIL_MAX = 254;
/** An accept or an assignment names at most this many tables. */
export const PICK_TABLES_MAX = 8;
/** The day view polls this often while the page is visible (plan §3.5). */
export const RESERVATIONS_REFRESH_MS = 60_000;

/**
 * The version of the privacy notice text a customer ticks (`privacy_notice_version`, 1 to 40 characters). It is bumped with every change of the
 * notice in `src/lib/i18n/messages` (plan §3.9). This is a DigiAlto draft: the client approves the text before go-live (Q-R12).
 */
export const RESERVATION_NOTICE_VERSION = "draft-2026-11-1";

/** The public request body is at most this many bytes (plan §3.2 decision 12). */
export const MAX_PUBLIC_REQUEST_BYTES = 4096;
