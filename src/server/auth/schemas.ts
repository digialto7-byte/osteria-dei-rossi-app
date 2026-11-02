import { z } from "zod";

// Request and reply shapes of the M25a sign-in and password routes (plan §3.4). Strict objects: withApi lists
// the names of bad fields only, never their values, so a password cannot end up in an error or a log.

const EMAIL_MAX = 254;
const NEXT_MAX = 512;
const PASSWORD_MAX = 200;

export const passwordSignInBody = z.strictObject({
  email: z.email().max(EMAIL_MAX),
  password: z.string().min(1).max(PASSWORD_MAX),
  next: z.string().max(NEXT_MAX).optional(),
});

export const emailCodeBody = z.strictObject({
  email: z.email().max(EMAIL_MAX),
  code: z.string().regex(/^\d{6}$/),
  next: z.string().max(NEXT_MAX).optional(),
});

export const passwordChangeBody = z.strictObject({
  newPassword: z.string().min(1).max(PASSWORD_MAX),
  currentPassword: z.string().min(1).max(PASSWORD_MAX).optional(),
});

export const passwordStatusOutput = z.strictObject({
  signInMethod: z.enum(["password", "link", "other"]),
  recentSignIn: z.boolean(),
  recentUntil: z.iso.datetime().nullable(),
  minLength: z.literal(10),
});

export type PasswordStatus = z.infer<typeof passwordStatusOutput>;
