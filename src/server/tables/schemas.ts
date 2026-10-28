import { z } from "zod";
import { hasTwoDecimals, vatRate } from "@/server/menu/schemas";
import { MAX_COPERTO_EUR, MAX_TABLE_COVERS, TABLE_NAME_MAX, TABLE_POSITION_MAX } from "./constants";

// Strict bodies of the table, session and coperto endpoints (M17 plan §3.4). The bounds mirror the SQL procedures,
// which stay the authority. The session id of an opening comes from the client (idempotent replay, M20).

export const idParams = z.object({ id: z.uuid() });

const covers = z.number().int().min(1).max(MAX_TABLE_COVERS);
const tableName = z
  .string()
  .max(TABLE_NAME_MAX)
  .refine((value) => value.trim() !== "", { message: "blank" });
const position = z.number().int().min(0).max(TABLE_POSITION_MAX);

export const openTableBody = z.strictObject({ sessionId: z.uuid(), covers });

export const sessionPatchBody = z
  .strictObject({ covers: covers.optional(), billRequested: z.boolean().optional() })
  .refine((body) => body.covers !== undefined || body.billRequested !== undefined, {
    message: "nothing to change",
  });

export const createDiningTableBody = z.strictObject({
  name: tableName,
  position: position.optional(),
});

export const updateDiningTableBody = z
  .strictObject({
    name: tableName.optional(),
    position: position.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "nothing to change",
  });

/**
 * Both keys are required; null clears. One null and one value is the database's coperto_invalid (422), so the
 * pair rule is not repeated here.
 */
export const copertoBody = z.strictObject({
  copertoAmount: z
    .number()
    .finite()
    .gt(0)
    .max(MAX_COPERTO_EUR)
    .refine(hasTwoDecimals, { message: "at most 2 decimals" })
    .nullable(),
  copertoVatRate: vatRate.nullable(),
});

export type OpenTableBody = z.infer<typeof openTableBody>;
export type SessionPatchBody = z.infer<typeof sessionPatchBody>;
export type CreateDiningTableBody = z.infer<typeof createDiningTableBody>;
export type UpdateDiningTableBody = z.infer<typeof updateDiningTableBody>;
export type CopertoBody = z.infer<typeof copertoBody>;
