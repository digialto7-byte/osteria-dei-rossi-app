import "server-only";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { RESERVATION_NOTICE_VERSION } from "../constants";
import { callGated } from "./client";
import { linkKeys, loadReservationEnv } from "./http";
import { requestReply, type RequestReply } from "./output";
import type { PublicRequestBody } from "./schemas";
import { checkFormToken } from "./tokens";

const FORM_ERRORS = {
  too_fast: "form_too_fast",
  expired: "form_expired",
  invalid: "form_invalid",
} as const;

/**
 * POST /api/public/reservations/:slug/requests, after the Origin, size and shape checks. In order:
 * 1. a filled honeypot answers as a success and writes nothing (the bot learns nothing);
 * 2. the signed form token: genuine, open for at least 3 s and for at most 2 h;
 * 3. the gated RPC, with the first x-forwarded-for entry as the address (the database stores only a salted daily hash of it).
 * The body the database gets has exactly its nine keys: the honeypot, the token and the checkbox stay here.
 */
export async function submitPublicRequest(input: {
  slug: string;
  body: PublicRequestBody;
  ip: string | null;
  nowMs: number;
}): Promise<RequestReply> {
  const { slug, body, ip, nowMs } = input;
  if (body.website.trim() !== "") return { status: "received" };
  // The per-address limit is the database's, and it refuses a request with no address: Vercel always sets x-forwarded-for, so none means not our route.
  if (ip === null) throw new ApiError(400, "invalid_request", "Richiesta non valida.");
  const check = checkFormToken(linkKeys(loadReservationEnv()), slug, body.formToken, nowMs);
  if (check !== "ok") {
    const code = FORM_ERRORS[check];
    throw new ApiError(422, code, t(`publicReservationError.${code}`));
  }
  return callGated(
    "request_reservation",
    slug,
    {
      p_body: {
        date: body.date,
        serviceKey: body.serviceKey,
        time: body.time,
        party: body.party,
        name: body.name,
        phone: body.phone,
        email: body.email,
        locale: body.locale,
        privacyNoticeVersion: RESERVATION_NOTICE_VERSION,
      },
      p_ip: ip,
    },
    requestReply,
    nowMs,
  );
}
