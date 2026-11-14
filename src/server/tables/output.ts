import { z } from "zod";

// Strict output schemas of the table endpoints (M17 plan §3.4). The services parse every database reply here, so a
// column that is not declared (a cost that slipped into an RPC reply) makes the parse throw: a 500, never a leak.
// The waiter shapes (tablesListOutput, openTableOutput, sessionResponse, sessionOutput) are snapshot-tested.
// The coperto is a sale charge the waiter may see; there is no cost, margin or recipe key anywhere.

/** What a session (or a tile with no joined booking) can be. A session is never "joined". */
export const SESSION_STATUS_VALUES = [
  "free",
  "open",
  "courses_sent",
  "bill_requested",
  "closed",
] as const;
/** A tile of the grid: the session statuses, plus "joined": a table of a seated combined booking, which belongs to the party at the lead table until that session closes (reservations V4). It has no session of its own. */
export const TABLE_STATUS_VALUES = [...SESSION_STATUS_VALUES, "joined"] as const;
const sessionStatus = z.enum(SESSION_STATUS_VALUES);
const status = z.enum(TABLE_STATUS_VALUES);

const waiter = z.strictObject({ id: z.uuid(), displayName: z.string() });
const coperto = z.strictObject({ perPerson: z.number(), vatRate: z.number(), total: z.number() });

/** A session as open_table and update_table_session return it. */
export const sessionOutput = z.strictObject({
  id: z.uuid(),
  tableId: z.uuid(),
  tableName: z.string(),
  covers: z.number().int(),
  openedAt: z.string(),
  businessDate: z.string(),
  waiter,
  billRequested: z.boolean(),
  coperto: coperto.nullable(),
});

export const openTableOutput = z.strictObject({ created: z.boolean(), session: sessionOutput });

export const sessionResponse = z.strictObject({
  session: sessionOutput.extend({ status: sessionStatus }),
});

const tileSession = z.strictObject({
  id: z.uuid(),
  covers: z.number().int(),
  openedAt: z.string(),
  openedToday: z.boolean(),
  waiter,
  billRequested: z.boolean(),
  // BQ-1: drafts that are not fired, not voided and not "a seguire" (server half of unsentLines). Required: a reply without it is refused, never defaulted.
  unsentCount: z.number().int().nonnegative(),
  coperto: coperto.nullable(),
});

export const tablesListOutput = z.strictObject({
  businessDate: z.string(),
  tables: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      position: z.number().int(),
      status,
      session: tileSession.nullable(),
      // Only a joined tile has it: the lead table the party sits at; overtime when now is past the seated booking's end (the lock has no time limit).
      joinedTo: z
        .strictObject({ id: z.uuid(), name: z.string(), overtime: z.boolean() })
        .optional(),
    }),
  ),
});

const diningTable = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
  active: z.boolean(),
  open: z.boolean(),
});
export const diningTablesOutput = z.strictObject({ tables: z.array(diningTable) });
export const createDiningTableOutput = z.strictObject({ table: diningTable });
export const updateDiningTableOutput = z.strictObject({ changed: z.boolean(), table: diningTable });

const copertoSetting = z.strictObject({ amount: z.number(), vatRate: z.number() });
export const copertoReadOutput = z.strictObject({
  coperto: copertoSetting.nullable(),
  defaults: z.strictObject({ vatRate: z.number().nullable() }),
  vatRates: z.array(z.number()),
});
export const copertoChangeOutput = z.strictObject({
  changed: z.boolean(),
  coperto: copertoSetting.nullable(),
});

export type TableStatus = (typeof TABLE_STATUS_VALUES)[number];
export type TablesList = z.infer<typeof tablesListOutput>;
export type TableTile = TablesList["tables"][number];
export type TableSession = z.infer<typeof sessionOutput>;
export type DiningTable = z.infer<typeof diningTable>;
export type CopertoRead = z.infer<typeof copertoReadOutput>;
export type SessionCoperto = z.infer<typeof coperto>;
