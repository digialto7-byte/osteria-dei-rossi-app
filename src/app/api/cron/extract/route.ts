import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runExtractionJob } from "@/server/cron/extract-job";
import { withCron } from "@/server/cron/with-cron";
import { createExtractionClient } from "@/server/extraction/client";

// Next.js needs a literal here; tests/app/api/cron/extract.test.ts pins it to EXTRACT_MAX_DURATION_S.
export const maxDuration = 120;

// One invoice per call (ADR-004). The work is awaited because pg_net waits for the answer.
export const POST = withCron(() =>
  runExtractionJob({
    admin: createSupabaseAdminClient(),
    makeClient: (env) => createExtractionClient(env),
    now: Date.now,
  }),
);
