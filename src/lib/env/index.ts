import { z } from "zod";
import { MIN_CRON_SECRET_CHARS } from "../../server/extraction/constants";

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
});

const cronSchema = z.object({
  CRON_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(MIN_CRON_SECRET_CHARS),
  ),
});

export interface ExtractionEnv {
  anthropicApiKey: string;
  modelId: string;
}

export interface CronEnv {
  cronSecret: string;
}

export function readExtractionEnv(source: Source = processSource()): ExtractionEnv {
  const parsed = parse(extractionSchema, source);
  return { anthropicApiKey: parsed.ANTHROPIC_API_KEY, modelId: parsed.EXTRACTION_MODEL_ID };
}

export function readCronEnv(source: Source = processSource()): CronEnv {
  return { cronSecret: parse(cronSchema, source).CRON_SECRET };
}
