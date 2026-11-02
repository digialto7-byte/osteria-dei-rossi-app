import { z } from "zod";

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
