import { z } from "zod";
import { MFA_SLOTS } from "@/lib/auth/mfa-constants";

// Request and reply shapes of the P2-1 second-factor routes (plan section 3.4). Strict objects: withApi lists the names of bad fields only, never their values,
// so a code cannot end up in an error or a log. No schema here has a field for a secret in a request: only the reply of the enrolment carries one, once.

const NEXT_MAX = 512;
const CODE = z.string().regex(/^\d{6}$/);

export const enrolBody = z.strictObject({ slot: z.enum(MFA_SLOTS) });
export const codeBody = z.strictObject({ code: CODE });
export const challengeBody = z.strictObject({
  factorId: z.uuid(),
  code: CODE,
  next: z.string().max(NEXT_MAX).optional(),
});
export const factorParams = z.object({ id: z.uuid() });

const factor = z.strictObject({
  id: z.uuid(),
  slot: z.enum([...MFA_SLOTS, "altro"]),
  status: z.enum(["verified", "unverified"]),
  createdAt: z.iso.datetime(),
});

export const mfaStatusOutput = z.strictObject({
  role: z.enum(["owner", "admin"]),
  mode: z.enum(["off", "enrolled", "required"]),
  gate: z.enum(["ok", "challenge", "enrol"]),
  currentLevel: z.enum(["aal1", "aal2"]),
  factors: z.array(factor),
  canAddFactor: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
});
export type MfaStatus = z.infer<typeof mfaStatusOutput>;

export const enrolOutput = z.strictObject({
  factorId: z.uuid(),
  slot: z.enum(MFA_SLOTS),
  qrImage: z.string().startsWith("data:image/svg+xml;utf-8,%3Csvg"),
  secret: z.string().min(1),
});

export const verifyOutput = z.strictObject({ factor: factor, currentLevel: z.literal("aal2") });
export const removeOutput = z.strictObject({ removed: z.literal(true) });
export const challengeOutput = z.strictObject({ redirect: z.string().startsWith("/") });

/** What public.mfa_status() answers (T-4). */
export const dbStatus = z.object({
  role: z.enum(["owner", "admin"]),
  mode: z.enum(["off", "enrolled", "required"]),
  hasVerifiedFactor: z.boolean(),
  gate: z.enum(["ok", "challenge", "enrol"]),
  issuer: z.string(),
});
/** What public.mfa_attempt_allowed() answers. */
export const dbAttempt = z.object({ allowed: z.boolean(), retryAfterSeconds: z.number().int() });
/** What public.mfa_enrol_check() answers. */
export const dbEnrolCheck = z.object({ issuer: z.string(), friendlyName: z.string() });

export const accountsOutput = z.strictObject({
  accounts: z.array(
    z.strictObject({
      id: z.uuid(),
      displayName: z.string(),
      role: z.enum(["owner", "admin"]),
      factorCount: z.number().int().min(0),
    }),
  ),
});
