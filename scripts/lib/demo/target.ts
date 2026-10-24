// Demo data (docs/plans/2026-10-24-demo-data.md §3.4): where the script may run, and in which mode.
// Local by default. Staging only with `--target staging`, DEMO_STAGING_OK=yes and the exact staging host. Any other hosted
// project is refused. No message repeats the URL or the value of the opt-in.
import { parseArgs } from "node:util";

/** The staging project (docs/plans/2026-10-24-demo-data.md §3.4). A project ref is an identifier, not a secret. */
export const STAGING_PROJECT_REF = "wjowhjsfpcdykxwgjipq";
const STAGING_HOST = `${STAGING_PROJECT_REF}.supabase.co`;

export type DemoTarget = "local" | "staging";
export type DemoMode = "seed" | "reset" | "purge" | "cleanup";

export interface ResolvedTarget {
  target: DemoTarget;
  mode: DemoMode;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalUrl(value: string): boolean {
  const url = parseUrl(value);
  return (
    url !== null &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.username === "" &&
    url.password === ""
  );
}

/** The exact staging origin: https, that host, no port (written out or not), no credentials, no path. */
function isStagingUrl(value: string): boolean {
  const url = parseUrl(value);
  if (url === null) return false;
  // `new URL` drops an explicit default port, so look at the text too.
  const explicitPort = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:\d+/i.test(value.trim());
  return (
    url.protocol === "https:" &&
    url.hostname === STAGING_HOST &&
    url.port === "" &&
    !explicitPort &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

export function resolveTarget(input: {
  argv: string[];
  env: Record<string, string | undefined>;
  supabaseUrl: string;
}): ResolvedTarget {
  const { values } = parseArgs({
    args: input.argv,
    strict: true,
    allowPositionals: false,
    options: {
      target: { type: "string" },
      reset: { type: "boolean" },
      purge: { type: "boolean" },
      cleanup: { type: "boolean" },
    },
  });

  const modes = [
    values.reset ? "reset" : null,
    values.purge ? "purge" : null,
    values.cleanup ? "cleanup" : null,
  ].filter((mode): mode is "reset" | "purge" | "cleanup" => mode !== null);
  if (modes.length > 1) throw new Error("Use only one of --reset, --purge and --cleanup.");
  const mode: DemoMode = modes[0] ?? "seed";

  if (values.target !== undefined && values.target !== "local" && values.target !== "staging") {
    throw new Error("--target accepts only: local or staging");
  }
  const target: DemoTarget = values.target === "staging" ? "staging" : "local";

  if (target === "local") {
    if (!isLocalUrl(input.supabaseUrl)) {
      throw new Error(
        "Refusing to run: the Supabase URL is not the local stack (127.0.0.1 or localhost).",
      );
    }
    return { target, mode };
  }

  if (input.env.DEMO_STAGING_OK !== "yes") {
    throw new Error(
      "Refusing --target staging: it needs the founder's OK, set DEMO_STAGING_OK=yes.",
    );
  }
  if (!isStagingUrl(input.supabaseUrl)) {
    throw new Error("Refusing --target staging: the Supabase URL is not the staging project.");
  }
  return { target, mode };
}
