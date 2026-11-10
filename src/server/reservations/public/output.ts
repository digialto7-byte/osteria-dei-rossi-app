import { z } from "zod";
import { RESERVATION_STATUSES } from "../constants";
import { parseReply } from "../output";

// What the anon functions may answer, parsed strictly: a key the schema does not know is a 500 and never a field on the page. No count, no table, no name, phone or e-mail.
export { parseReply };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const pageReply = z.strictObject({
  venueName: z.string(),
  services: z.array(z.strictObject({ key: z.string(), name: z.string() })),
  minDate: isoDate,
  maxDate: isoDate,
  closedWeekdays: z.array(z.number().int().min(1).max(7)),
  closedDates: z.array(isoDate),
  maxPartyOnline: z.number().int(),
  venuePhone: z.string().nullable(),
  privacy: z.strictObject({
    controllerName: z.string().nullable(),
    controllerVat: z.string().nullable(),
    contactEmail: z.string().nullable(),
  }),
});
export type PageReply = z.infer<typeof pageReply>;

export interface PublicPage extends Omit<PageReply, "privacy"> {
  privacy: PageReply["privacy"] & { noticeVersion: string };
  formToken: string;
}

export const slotsReply = z.strictObject({
  date: isoDate,
  closed: z.boolean(),
  services: z.array(
    z.strictObject({
      key: z.string(),
      name: z.string(),
      slots: z.array(z.strictObject({ time: hhmm, available: z.boolean() })),
    }),
  ),
});
export type SlotsReply = z.infer<typeof slotsReply>;

export const requestReply = z.strictObject({ status: z.literal("received") });
export type RequestReply = z.infer<typeof requestReply>;

export const cancelViewReply = z.strictObject({
  date: isoDate,
  time: hhmm,
  party: z.number().int(),
  serviceName: z.string(),
  status: z.enum(RESERVATION_STATUSES),
  canCancel: z.boolean(),
});
export type CancelViewReply = z.infer<typeof cancelViewReply>;

export const cancelReply = z.strictObject({
  status: z.literal("cancelled"),
  already: z.boolean(),
});
export type CancelReply = z.infer<typeof cancelReply>;
