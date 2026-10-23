import { z } from "zod";
import {
  DISPLAY_NAME_MAX_CHARS,
  ENROLMENT_CODE_INPUT_MAX,
  LABEL_MAX_CHARS,
  PIN_LENGTH,
} from "./constants";

// Request bodies are strict objects. The messages of these issues never carry a value (withApi lists field
// names only), so a PIN typed wrongly cannot end up in an error response or a log.

/** Four ASCII digits. The triviality rule is checked separately (pin-policy.ts) and answers 422. */
export const pinField = z.string().regex(new RegExp(`^[0-9]{${PIN_LENGTH}}$`));

const trimmedName = (max: number) => z.string().trim().min(1).max(max);

export const pinLoginBody = z.strictObject({ userId: z.uuid(), pin: pinField });
export const enrolBody = z.strictObject({ code: z.string().min(1).max(ENROLMENT_CODE_INPUT_MAX) });
export const enrolmentCodeBody = z.strictObject({ label: trimmedName(LABEL_MAX_CHARS) });
export const staffRole = z.enum(["chef", "waiter"]);
export const createUserBody = z.strictObject({
  displayName: trimmedName(DISPLAY_NAME_MAX_CHARS),
  role: staffRole,
  pin: pinField,
});
export const patchUserBody = z
  .strictObject({
    displayName: trimmedName(DISPLAY_NAME_MAX_CHARS).optional(),
    role: staffRole.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "no_fields" });
export const pinBody = z.strictObject({ pin: pinField });

export type PinLoginBody = z.infer<typeof pinLoginBody>;
export type CreateUserBody = z.infer<typeof createUserBody>;
export type PatchUserBody = z.infer<typeof patchUserBody>;
