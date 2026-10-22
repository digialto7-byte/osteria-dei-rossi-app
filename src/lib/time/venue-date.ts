import { VENUE_TIME_ZONE } from "@/lib/time/format";

const yearFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VENUE_TIME_ZONE,
  year: "numeric",
});

/** Calendar year of an instant in venue time (Europe/Rome), e.g. for storage folders. */
export function venueYear(instant: Date): number {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("venueYear: invalid date");
  }
  return Number(yearFormatter.format(instant));
}
