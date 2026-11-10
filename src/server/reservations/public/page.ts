import { RESERVATION_NOTICE_VERSION } from "../constants";
import { callGated } from "./client";
import { linkKeys, loadReservationEnv } from "./http";
import { pageReply, type PublicPage } from "./output";
import { signFormToken } from "./tokens";

/** GET /api/public/reservations/:slug/page: the configuration of the booking page, the notice version and a signed form token (it opens after 3 s). */
export async function readPublicPage(slug: string, nowMs: number): Promise<PublicPage> {
  const reply = await callGated("reservation_page", slug, {}, pageReply, nowMs);
  const env = loadReservationEnv();
  return {
    ...reply,
    privacy: { ...reply.privacy, noticeVersion: RESERVATION_NOTICE_VERSION },
    formToken: signFormToken(linkKeys(env), slug, nowMs),
  };
}
