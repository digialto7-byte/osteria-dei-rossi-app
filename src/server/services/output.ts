import { z } from "zod";
import { PERIODS } from "@/server/reports/constants";

// Strict output schemas of the service endpoints (M25c plan §3.4). A reply is parsed before it is sent, so a key the SQL adds without this file
// knowing it (a staff name, a position) fails the parse and the route answers 500 instead of passing it on.

const period = z.strictObject({
  key: z.string(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});

export const servicePeriodsOutput = z.strictObject({
  periods: z.array(period),
  cutoff: z.string(),
  since: z.iso.datetime({ offset: true }).nullable(),
  isDefault: z.boolean(),
});

export const setServicePeriodsOutput = servicePeriodsOutput.extend({ changed: z.boolean() });

export type ServicePeriods = z.infer<typeof servicePeriodsOutput>;

export const sessionServiceOutput = z.strictObject({
  changed: z.boolean(),
  session: z.strictObject({
    sessionId: z.uuid(),
    serviceKey: z.string(),
    source: z.enum(["auto", "override"]),
  }),
});

const eur = z.number();
const count = z.number().int();
const instant = z.iso.datetime({ offset: true });

/** The day close's split: the app side only, per service, and the day's sessions with their service. No staff name and no cost. */
export const dayServicesOutput = z.strictObject({
  businessDate: z.iso.date(),
  final: z.boolean(),
  services: z.array(
    z.strictObject({
      key: z.string(),
      name: z.string(),
      position: count.nullable(),
      startsAt: z.string().nullable(),
      endsAt: z.string().nullable(),
      tables: count,
      covers: count,
      totalEur: eur,
      revenueNetEur: eur,
      openTables: count,
    }),
  ),
  total: z.strictObject({
    tables: count,
    covers: count,
    totalEur: eur,
    revenueNetEur: eur,
    openTables: count,
  }),
  sessions: z.array(
    z.strictObject({
      sessionId: z.uuid(),
      tableName: z.string(),
      openedAt: instant,
      closedAt: instant.nullable(),
      covers: count,
      totalEur: eur.nullable(),
      serviceKey: z.string(),
      source: z.enum(["auto", "override"]),
      choices: z.array(z.string()),
      canChange: z.boolean(),
    }),
  ),
});

export type DayServices = z.infer<typeof dayServicesOutput>;
export type SessionServiceReply = z.infer<typeof sessionServiceOutput>;

const pct = z.number();
const block = {
  covers: count,
  tables: count,
  revenueGrossEur: eur,
  revenueNetEur: eur,
  avgSpendPerCoverEur: eur.nullable(),
  avgTicketEur: eur.nullable(),
  plates: z.number(),
  foodCostEur: eur,
  foodCostPct: pct.nullable(),
  costedRevenueNetEur: eur,
  costedSharePct: pct.nullable(),
  revenueSharePct: pct.nullable(),
};

/**
 * The report split by service (plan §3.4): the same keys for owner and admin, no fixed cost, no comparison period. A removed service that still has
 * data in the range comes with position null.
 */
export const servicesReportOutput = z.strictObject({
  period: z.enum(PERIODS),
  from: z.iso.date(),
  to: z.iso.date(),
  final: z.boolean(),
  daysFinal: count,
  days: count,
  services: z.array(
    z.strictObject({ key: z.string(), name: z.string(), position: count.nullable(), ...block }),
  ),
  total: z.strictObject(block),
});

export type ServicesReport = z.infer<typeof servicesReportOutput>;
