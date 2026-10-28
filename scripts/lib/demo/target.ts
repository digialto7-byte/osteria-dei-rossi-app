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
  /** The existing tenant to fill, reset or inspect (lower case). Null for --cleanup, which works on every pending clean-up. */
  tenantId: string | null;
  /** Skip the script's own "holds operational data" check. The database check stays. */
  force: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      tenant: { type: "string" },
      force: { type: "boolean" },
    },
  });

  const modes = [
    values.reset ? "reset" : null,
    values.purge ? "purge" : null,
    values.cleanup ? "cleanup" : null,
  ].filter((mode): mode is "reset" | "purge" | "cleanup" => mode !== null);
  if (modes.length > 1) throw new Error("Use only one of --reset, --purge and --cleanup.");
  const mode: DemoMode = modes[0] ?? "seed";

  // The tenant is named by id and never guessed. The value is not repeated in a message (it is a client fact).
  let tenantId: string | null = null;
  if (input.argv.filter((a) => a === "--tenant" || a.startsWith("--tenant=")).length > 1) {
    throw new Error("--tenant <uuid> may be given only once.");
  }
  if (mode !== "cleanup") {
    if (values.tenant === undefined || !UUID.test(values.tenant)) {
      throw new Error("--tenant <uuid> is required: the id of the existing tenant to use.");
    }
    tenantId = values.tenant.toLowerCase();
  }
  const force = values.force === true;
  if (force && (mode === "purge" || mode === "cleanup")) {
    throw new Error("--force applies only to a seed or a --reset.");
  }

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
    return { target, mode, tenantId, force };
  }

  if (input.env.DEMO_STAGING_OK !== "yes") {
    throw new Error(
      "Refusing --target staging: it needs the founder's OK, set DEMO_STAGING_OK=yes.",
    );
  }
  if (!isStagingUrl(input.supabaseUrl)) {
    throw new Error("Refusing --target staging: the Supabase URL is not the staging project.");
  }
  return { target, mode, tenantId, force };
}
