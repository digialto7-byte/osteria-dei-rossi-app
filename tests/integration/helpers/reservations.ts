import { quoteUuid, runSql } from "./sql";

// Helpers of the reservations integration suite (reservations plan A14, fake data only). A customer's request has no route in PR1 (the public page is PR2), so
// requests are created the way the pgTAP tests create them: through psql, calling `app.request_reservation_at` as the database owner. psql is used only for what the API
// cannot do (seeding a request, moving a booking's clock to today, reading the outbox); every assertion about what a user may do goes through the routes.

/** A fake salt for the daily-hash throttle, created in Vault when the local stack has none (the real value is a secret, PR2's seed). */
export const FAKE_HASH_SALT = "test-salt-not-a-secret-0123456789-abcdef";
/** The version string of the privacy notice the request carries. */
const NOTICE_VERSION = "demo-1";

export interface RequestSeed {
  date: string;
  time: string;
  serviceKey: string;
  party: number;
  name: string;
  phone: string;
  email: string;
  /** The first x-forwarded-for entry of the customer: only a function argument, never stored. */
  ip: string;
}

/** An SQL string literal. A backslash or a NUL is refused: the values here are fake and plain, so nothing needs them. */
export function quoteLiteral(value: string): string {
  if (value.includes("\\") || value.includes("\0")) throw new Error("Not a plain string");
  return `'${value.replace(/'/g, "''")}'`;
}

const IP = /^[0-9a-f:.]{3,45}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The SQL of one request: the salt if missing, then app.request_reservation_at with the venue's real "now". Its last statement returns {"status": "received"}. */
export function requestSql(tenantId: string, seed: RequestSeed): string {
  if (!IP.test(seed.ip)) throw new Error("Not an IP address");
  const body = JSON.stringify({
    date: seed.date,
    serviceKey: seed.serviceKey,
    time: seed.time,
    party: seed.party,
    name: seed.name,
    phone: seed.phone,
    email: seed.email,
    locale: "it",
    privacyNoticeVersion: NOTICE_VERSION,
  });
  return (
    `select vault.create_secret(${quoteLiteral(FAKE_HASH_SALT)}, 'reservation_hash_salt') ` +
    `where not exists (select 1 from vault.secrets where name = 'reservation_hash_salt'); ` +
    `select app.request_reservation_at(${quoteUuid(tenantId)}, ${quoteLiteral(body)}::jsonb, ${quoteLiteral(seed.ip)}, now())`
  );
}

/** The last non-empty line of psql's output: with several statements in one call, the first one (the Vault secret's id) prints too. */
export function lastLine(output: string): string {
  return (
    output
      .split("\n")
      .filter((line) => line.trim() !== "")
      .at(-1) ?? ""
  );
}

/** Seeds one pending request as a customer would have sent it; returns the database's reply text (`{"status": "received"}`). */
export function seedRequest(tenantId: string, seed: RequestSeed): string {
  return lastLine(runSql(requestSql(tenantId, seed)));
}

/**
 * Moves a booking to a business date and to one hour from now, so a waiter can mark it arrived and open its table whatever the clock of the run is. The `move` route
 * refuses a start in the past, and a run late in the evening has no future Cena slot today. The tables of its assignment stay as they are.
 */
export function moveToDaySql(reservationId: string, businessDate: string): string {
  if (!DATE.test(businessDate)) throw new Error("Not a calendar date");
  return (
    `update public.reservation set business_date = '${businessDate}', starts_at = now() + interval '1 hour', ` +
    `ends_at = now() + interval '3 hours', updated_at = now() where id = ${quoteUuid(reservationId)}`
  );
}

export function moveToDay(reservationId: string, businessDate: string): void {
  runSql(moveToDaySql(reservationId, businessDate));
}

/** The outbox rows of one booking as `kind:status:sent`, no address: the outbox holds none. */
export function emailRowsSql(reservationId: string): string {
  return (
    `select coalesce(string_agg(kind || ':' || status || ':' || (sent_at is not null)::text, ',' order by created_at, kind), '') ` +
    `from public.reservation_email where reservation_id = ${quoteUuid(reservationId)}`
  );
}

export function emailRows(reservationId: string): string[] {
  const text = runSql(emailRowsSql(reservationId));
  return text === "" ? [] : text.split(",");
}

/** The table session a booking is linked to, as `<dining table id>:<covers>`, or an empty string. */
export function linkedSession(reservationId: string): string {
  return runSql(
    `select coalesce((select s.dining_table_id::text || ':' || s.covers::text from public.reservation r ` +
      `join public.table_session s on s.tenant_id = r.tenant_id and s.id = r.table_session_id where r.id = ${quoteUuid(reservationId)}), '')`,
  );
}
