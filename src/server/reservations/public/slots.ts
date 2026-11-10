import { callGated } from "./client";
import { slotsReply, type SlotsReply } from "./output";

/** GET /api/public/reservations/:slug/slots: which times are free for a date and a party. The database returns no counts. */
export const readPublicSlots = (
  slug: string,
  query: { date: string; party: number },
  nowMs: number,
): Promise<SlotsReply> =>
  callGated(
    "reservation_slots",
    slug,
    { p_date: query.date, p_party: query.party },
    slotsReply,
    nowMs,
  );
