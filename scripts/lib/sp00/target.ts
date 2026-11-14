// SP0 spike (docs/plans/2026-11-14-sp00-spike.md §3.5): where the scripts may run, and which project ref the lead may hand
// to the Supabase connector. Local stack, or the one declared temporary project. The staging project is refused by name
// (its ref is a literal in code, reused from the demo target), and so is PRODUCTION_PROJECT_REF when it is set. No message
// repeats a URL, a ref or a key.
import { STAGING_PROJECT_REF } from "../demo/target";

export type SpikeTargetName = "local" | "temp";
export type Env = Record<string, string | undefined>;

export interface SpikeTarget {
  target: SpikeTargetName;
  /** The temporary project's ref; null on the local stack. */
  ref: string | null;
}

/** A Supabase project ref is a short lower-case identifier. Anything else is refused before it reaches a URL or a connector call. */
const REF_FORMAT = /^[a-z0-9]{10,40}$/;
const API_SUFFIX = ".supabase.co";

const STAGING_REFUSAL = "Refusing: this is the staging project. SP0 never touches staging.";
const PRODUCTION_REFUSAL =
  "Refusing: this is the production project. SP0 never touches production.";

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

/** The ref of an exact `https://<ref>.supabase.co` origin (no port written or implied, no credentials, no path), else null. */
function refOfExactApiUrl(value: string): string | null {
  const url = parseUrl(value);
  if (url === null) return null;
  // `new URL` drops an explicit default port, so look at the text too.
  const explicitPort = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:\d+/i.test(value.trim());
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    explicitPort ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.hostname.endsWith(API_SUFFIX)
  ) {
    return null;
  }
  const ref = url.hostname.slice(0, -API_SUFFIX.length);
  return REF_FORMAT.test(ref) ? ref : null;
}

/** Throws the by-name refusal when `candidate` is the staging or the production project. The literal staging ref is always checked. */
function refuseForbiddenRef(candidate: string | null, env: Env): void {
  if (candidate === null || candidate === "") return;
  const staging = [STAGING_PROJECT_REF, env.STAGING_PROJECT_REF];
  if (staging.includes(candidate)) throw new Error(STAGING_REFUSAL);
  const production = env.PRODUCTION_PROJECT_REF;
  if (production !== undefined && production !== "" && production === candidate) {
    throw new Error(PRODUCTION_REFUSAL);
  }
}

/** The ref in the text of a URL's host, for the by-name check, whatever else is wrong with the URL. */
function hostRefOf(value: string): string | null {
  const url = parseUrl(value);
  if (url === null || !url.hostname.endsWith(API_SUFFIX)) return null;
  return url.hostname.slice(0, -API_SUFFIX.length);
}

export function resolveSpikeTarget(input: {
  target: SpikeTargetName;
  env: Env;
  supabaseUrl: string;
}): SpikeTarget {
  const { target, env, supabaseUrl } = input;
  if (target === "local") {
    if (!isLocalUrl(supabaseUrl)) {
      throw new Error(
        "Refusing to run: the Supabase URL is not the local stack (127.0.0.1 or localhost).",
      );
    }
    return { target, ref: null };
  }

  // By-name refusals first: they must show even when the opt-in or the declared ref is missing.
  refuseForbiddenRef(hostRefOf(supabaseUrl), env);
  refuseForbiddenRef(env.SPIKE_PROJECT_REF ?? null, env);

  if (env.SPIKE_TEMP_OK !== "yes") {
    throw new Error(
      "Refusing --target temp: set SPIKE_TEMP_OK=yes once the temporary project exists.",
    );
  }
  const declared = env.SPIKE_PROJECT_REF;
  if (declared === undefined || !REF_FORMAT.test(declared)) {
    throw new Error("Refusing --target temp: SPIKE_PROJECT_REF is not set to a project ref.");
  }
  if (refOfExactApiUrl(supabaseUrl) !== declared) {
    throw new Error(
      "Refusing --target temp: the Supabase URL is not the declared temporary project.",
    );
  }
  return { target, ref: declared };
}

/** The guard for the project_id the lead is about to pass to the connector (sp00-ref-check.ts). */
export function checkConnectorRef(ref: string, env: Env): void {
  refuseForbiddenRef(ref, env);
  refuseForbiddenRef(env.SPIKE_PROJECT_REF ?? null, env);
  if (!REF_FORMAT.test(ref)) throw new Error("Refusing: that is not a project ref.");
  const declared = env.SPIKE_PROJECT_REF;
  if (declared === undefined || !REF_FORMAT.test(declared)) {
    throw new Error("Refusing: SPIKE_PROJECT_REF is not set to a project ref.");
  }
  if (ref !== declared) {
    throw new Error("Refusing: that ref is not the declared temporary project.");
  }
}
