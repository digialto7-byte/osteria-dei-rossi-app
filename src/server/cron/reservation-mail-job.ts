import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailEnv } from "@/lib/env";
import { reportError } from "@/lib/observability/report";
import { MailError, type MailSender } from "@/server/mail";
import { MAIL_BATCH } from "@/server/reservations/mail/constants";
import { claimedMail, renderReservationMail } from "@/server/reservations/mail/render";
import type { LinkKeys } from "@/server/reservations/public/tokens";

// The one place where the secret-key client meets the mail sender (ADR-032 decision 4). `admin` is handed in by withCron, so this module is only reachable from
// the cron route. Per row: render -> send -> finish. A row that fails never stops the rest, and nothing but ids and codes is logged: no address, name, token or key.

export interface ReservationMailJobDeps {
  /** The secret-key client; only the claim and the finish are called on it. */
  admin: SupabaseClient;
  sender: MailSender;
  mail: MailEnv;
  keys: LinkKeys;
  /** One JSON line per row; defaults to console.warn. */
  log?: (entry: Record<string, string>) => void;
}

export interface ReservationMailJobResult {
  handled: number;
  sent: number;
  failed: number;
}

const defaultLog = (entry: Record<string, string>) =>
  console.warn(JSON.stringify({ event: "reservation-mail", ...entry }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const codeOf = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";

export async function runReservationMailJob(
  deps: ReservationMailJobDeps,
): Promise<ReservationMailJobResult> {
  const { admin, sender, mail, keys } = deps;
  const log = deps.log ?? defaultLog;

  const claim = await admin.rpc("reservation_mail_claim", { p_limit: MAIL_BATCH });
  if (claim.error) throw new Error(`reservation_mail_claim failed: ${codeOf(claim.error)}`);
  if (!Array.isArray(claim.data)) throw new Error("reservation_mail_claim returned no list");

  const result: ReservationMailJobResult = { handled: 0, sent: 0, failed: 0 };

  /** Records the outcome in the database. A failure to record is reported by code; the row's lease then runs out and the database retries it. */
  const finish = async (id: string, ok: boolean, provider: string | null, error: string | null) => {
    try {
      const { error: failure } = await admin.rpc("reservation_mail_finish", {
        p_id: id,
        p_ok: ok,
        p_provider: provider,
        p_error: error,
      });
      if (failure) reportError(new Error(`reservation_mail_finish failed: ${codeOf(failure)}`));
    } catch {
      reportError(new Error("reservation_mail_finish failed: unknown"));
    }
  };

  for (const raw of claim.data as unknown[]) {
    result.handled += 1;
    const parsed = claimedMail.safeParse(raw);
    if (!parsed.success) {
      // Not a row this version can write. Without an id there is nothing to finish; with one it is refused for good.
      const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
      result.failed += 1;
      if (typeof id === "string" && UUID.test(id)) {
        log({ id, outcome: "failed", code: "row_invalid" });
        await finish(id, false, null, "rejected");
      } else {
        log({ outcome: "failed", code: "row_invalid" });
      }
      continue;
    }
    const row = parsed.data;
    try {
      const rendered = renderReservationMail(row, { origin: mail.appPublicOrigin, keys });
      const { providerId } = await sender.send({
        to: row.to,
        from: mail.from,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotencyKey: row.id,
      });
      result.sent += 1;
      log({ id: row.id, outcome: "sent" });
      await finish(row.id, true, providerId, null);
    } catch (error) {
      const kind = error instanceof MailError ? error.kind : "retry";
      result.failed += 1;
      log({
        id: row.id,
        outcome: "failed",
        code: error instanceof MailError ? error.message : kind,
      });
      await finish(row.id, false, null, kind);
    }
  }
  return result;
}
