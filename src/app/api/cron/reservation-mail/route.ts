import { readMailEnv, readReservationEnv } from "@/lib/env";
import {
  runReservationMailJob,
  type ReservationMailJobResult,
} from "@/server/cron/reservation-mail-job";
import { withCron } from "@/server/cron/with-cron";
import { createMailSender } from "@/server/mail";

// Next.js needs a literal here; tests/app/api/cron/reservation-mail.test.ts pins it to MAIL_MAX_DURATION_S.
export const maxDuration = 120;

// pg_cron calls this every minute while an e-mail is due (app.reservation_mail_due). The work is awaited because pg_net waits for the answer. The settings are
// read before the claim, so a missing variable claims nothing.
export const POST = withCron(
  { job: "reservation-mail", countItems: (result: ReservationMailJobResult) => result.handled },
  (_request, admin) => {
    const mail = readMailEnv();
    const reservation = readReservationEnv();
    return runReservationMailJob({
      admin,
      sender: createMailSender(mail),
      mail,
      keys: { current: reservation.linkKey, previous: reservation.linkKeyPrevious },
    });
  },
);
