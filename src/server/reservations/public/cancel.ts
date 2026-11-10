import "server-only";
import { ApiError } from "@/lib/api/errors";
import { callGated } from "./client";
import { linkKeys, loadReservationEnv } from "./http";
import { linkInvalid } from "./errors";
import { cancelReply, cancelViewReply, type CancelReply, type CancelViewReply } from "./output";
import { verifyCancelToken } from "./tokens";

/**
 * The id and expiry of a genuine, unexpired cancel token. A bad MAC, a wrong kid, garbage and an expired link are all the same 404 `link_invalid`, and the
 * MAC is checked here, before any database call, so a guess costs nothing and tells nothing (ADR-032 decision 5).
 */
function openToken(token: string, nowMs: number) {
  const opened = verifyCancelToken(linkKeys(loadReservationEnv()), token, Math.floor(nowMs / 1000));
  if (!opened) throw linkInvalid();
  return opened;
}

/** The database does not know the booking, or it belongs to another page: indistinguishable from a bad link. */
async function asLink<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") throw linkInvalid();
    throw error;
  }
}

/** GET /api/public/reservations/:slug/cancel?t=: the booking summary. It never writes. */
export async function readCancelView(
  slug: string,
  token: string,
  nowMs: number,
): Promise<CancelViewReply> {
  const { reservationId, exp } = openToken(token, nowMs);
  return asLink(() =>
    callGated(
      "reservation_cancel_view",
      slug,
      { p_reservation: reservationId, p_exp: exp },
      cancelViewReply,
      nowMs,
    ),
  );
}

/** POST /api/public/reservations/:slug/cancel: cancels once; a second use answers `already: true`. */
export async function cancelByLink(
  slug: string,
  token: string,
  nowMs: number,
): Promise<CancelReply> {
  const { reservationId, exp } = openToken(token, nowMs);
  return asLink(() =>
    callGated(
      "cancel_reservation",
      slug,
      { p_reservation: reservationId, p_exp: exp },
      cancelReply,
      nowMs,
    ),
  );
}
