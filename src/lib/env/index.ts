import type { OutputConfig } from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";

/** Shortest CRON_SECRET accepted (`openssl rand -hex 32` gives 64). */
export const MIN_CRON_SECRET_CHARS = 32;

/** Raised when the process environment is missing or has an invalid variable. */
export class ConfigError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Invalid or missing environment variables: ${variables.join(", ")}`);
    this.name = "ConfigError";
  }
}

type Source = Record<string, string | undefined>;

// Empty strings count as missing: a blank line in .env must not pass as configured.
const required = z.preprocess((value) => (value === "" ? undefined : value), z.string());
const requiredUrl = z.preprocess((value) => (value === "" ? undefined : value), z.url());
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.url().optional());

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required,
});

const serverSchema = publicSchema.extend({
  SENTRY_DSN: optionalUrl,
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
});

function parse<T extends z.ZodType>(schema: T, source: Source): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Only variable names go into the error; values may be secrets.
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(names);
  }
  return result.data;
}

export interface PublicEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export type Deployment = "production" | "preview" | "development";

export interface ServerEnv extends PublicEnv {
  sentryDsn: string | undefined;
  deployment: Deployment;
}

function toPublic(parsed: z.infer<typeof publicSchema>): PublicEnv {
  return {
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

// Next.js inlines NEXT_PUBLIC_* only for literal `process.env.NAME` reads, so they are listed here.
function processSource(): Source {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function readPublicEnv(source: Source = processSource()): PublicEnv {
  return toPublic(parse(publicSchema, source));
}

export function readServerEnv(source: Source = processSource()): ServerEnv {
  const parsed = parse(serverSchema, source);
  return {
    ...toPublic(parsed),
    sentryDsn: parsed.SENTRY_DSN,
    deployment: parsed.VERCEL_ENV ?? "development",
  };
}

export const EXTRACTION_EFFORTS = ["low", "medium", "high"] as const satisfies readonly NonNullable<
  OutputConfig["effort"]
>[];
export type ExtractionEffort = (typeof EXTRACTION_EFFORTS)[number];

// The extraction variables are not part of serverSchema: user-facing routes must boot without them.
const extractionSchema = z.object({
  ANTHROPIC_API_KEY: required,
  // Whatever the provider calls the model; never a literal in src/ (ADR-004, AT5).
  EXTRACTION_MODEL_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  ),
  // Line extraction is transcription: low effort keeps a real invoice inside EXTRACTION_TIMEOUT_MS.
  EXTRACTION_EFFORT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(EXTRACTION_EFFORTS).default("low"),
  ),
});

const cronSchema = z.object({
  CRON_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(MIN_CRON_SECRET_CHARS),
  ),
});

/** Shortest PIN_PEPPER accepted (`openssl rand -hex 32` gives 64). */
export const MIN_PIN_PEPPER_CHARS = 32;

// Read only by the staff-auth services (PIN derivation, IP hashing); never part of serverSchema, so routes
// without staff login boot without it.
const pinSchema = z.object({
  PIN_PEPPER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(MIN_PIN_PEPPER_CHARS),
  ),
});

export interface PinEnv {
  pinPepper: string;
}

export interface ExtractionEnv {
  anthropicApiKey: string;
  modelId: string;
  effort: ExtractionEffort;
}

export interface CronEnv {
  cronSecret: string;
}

export function readExtractionEnv(source: Source = processSource()): ExtractionEnv {
  const parsed = parse(extractionSchema, source);
  return {
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    modelId: parsed.EXTRACTION_MODEL_ID,
    effort: parsed.EXTRACTION_EFFORT,
  };
}

export function readCronEnv(source: Source = processSource()): CronEnv {
  return { cronSecret: parse(cronSchema, source).CRON_SECRET };
}

export function readPinEnv(source: Source = processSource()): PinEnv {
  return { pinPepper: parse(pinSchema, source).PIN_PEPPER };
}

/**
 * True when PIN login can work here: `PIN_PEPPER` is present and long enough. Read by the device list so the
 * setup guide can warn the owner; it never returns the value. The secret key is not checked: only admin.ts reads it.
 */
export function isPinPepperConfigured(source: Source = processSource()): boolean {
  return pinSchema.safeParse(source).success;
}

/** Shortest reservation gate or link key accepted (`openssl rand -hex 32` gives 64). */
export const MIN_RESERVATION_KEY_CHARS = 32;

const reservationKey = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(MIN_RESERVATION_KEY_CHARS),
);

// Read only by the public reservation routes and the mail cron (ADR-032); never part of serverSchema, so the staff app boots without them.
const reservationSchema = z.object({
  RESERVATION_GATE_KEY: reservationKey,
  RESERVATION_LINK_KEY: reservationKey,
  // Kept during a link-key rotation, until every older link has expired.
  RESERVATION_LINK_KEY_PREVIOUS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(MIN_RESERVATION_KEY_CHARS).optional(),
  ),
});

export interface ReservationEnv {
  /** Signs the route gate the anon functions check (same value as Vault `reservation_gate_key`). */
  gateKey: string;
  /** Signs the cancel links and the form tokens. */
  linkKey: string;
  linkKeyPrevious: string | undefined;
}

/** Prefix of the `.env.example` fakes; a production key must never start with it. */
const PLACEHOLDER_KEY_PREFIX = "replace-me";

/**
 * The public reservation routes' keys. A key starting with `replace-me` (the `.env.example` placeholder) is refused when
 * `VERCEL_ENV=production`, as `readMailEnv` refuses `mailpit`. Only variable names go into the error.
 */
export function readReservationEnv(source: Source = processSource()): ReservationEnv {
  const parsed = parse(reservationSchema, source);
  if (source.VERCEL_ENV === "production") {
    const problems = (
      [
        ["RESERVATION_GATE_KEY", parsed.RESERVATION_GATE_KEY],
        ["RESERVATION_LINK_KEY", parsed.RESERVATION_LINK_KEY],
        ["RESERVATION_LINK_KEY_PREVIOUS", parsed.RESERVATION_LINK_KEY_PREVIOUS],
      ] as const
    )
      .filter(([, value]) => value?.startsWith(PLACEHOLDER_KEY_PREFIX))
      .map(([name]) => name);
    if (problems.length > 0) throw new ConfigError(problems);
  }
  return {
    gateKey: parsed.RESERVATION_GATE_KEY,
    linkKey: parsed.RESERVATION_LINK_KEY,
    linkKeyPrevious: parsed.RESERVATION_LINK_KEY_PREVIOUS,
  };
}

export const MAIL_TRANSPORTS = ["resend", "mailpit"] as const;
export type MailTransportName = (typeof MAIL_TRANSPORTS)[number];

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);
const mailSchema = z.object({
  MAIL_TRANSPORT: z.preprocess(blankToUndefined, z.enum(MAIL_TRANSPORTS)),
  MAIL_FROM: z.preprocess(blankToUndefined, z.string().min(3).max(200)),
  APP_PUBLIC_ORIGIN: requiredUrl,
  RESEND_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  MAILPIT_URL: optionalUrl,
});

export interface MailEnv {
  transport: MailTransportName;
  from: string;
  /** The origin cancel links are built on, without a trailing slash. */
  appPublicOrigin: string;
  resendApiKey: string | undefined;
  mailpitUrl: string | undefined;
}

/**
 * The mail cron's settings. `mailpit` is a dev and test sink and is refused when `VERCEL_ENV=production`; production links must be https.
 * Only variable names go into the error.
 */
export function readMailEnv(source: Source = processSource()): MailEnv {
  const parsed = parse(mailSchema, source);
  const production = source.VERCEL_ENV === "production";
  const problems: string[] = [];
  if (production && parsed.MAIL_TRANSPORT === "mailpit") problems.push("MAIL_TRANSPORT");
  if (parsed.MAIL_TRANSPORT === "resend" && !parsed.RESEND_API_KEY) problems.push("RESEND_API_KEY");
  if (parsed.MAIL_TRANSPORT === "mailpit" && !parsed.MAILPIT_URL) problems.push("MAILPIT_URL");
  const origin = new URL(parsed.APP_PUBLIC_ORIGIN);
  if (production && origin.protocol !== "https:") problems.push("APP_PUBLIC_ORIGIN");
  if (problems.length > 0) throw new ConfigError(problems);
  return {
    transport: parsed.MAIL_TRANSPORT,
    from: parsed.MAIL_FROM,
    appPublicOrigin: origin.origin,
    resendApiKey: parsed.RESEND_API_KEY,
    mailpitUrl: parsed.MAILPIT_URL?.replace(/\/+$/, ""),
  };
}
