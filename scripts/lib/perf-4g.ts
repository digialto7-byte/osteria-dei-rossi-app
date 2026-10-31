// AT7's evidence for the owner dashboard (M22 plan §5 step 18, PRD: the dashboard loads in under 2 seconds on a phone over 4G):
// how long until the "Ieri" tile is visible, seen from a GitHub runner through a simulated Slow 4G connection in Chromium, against
// the STAGING app only. All I/O is injected, so the unit test drives it with fakes. Started by hand by the founder from the
// `perf-dashboard-4g` workflow on `main`. It reports numbers and promises none; the exit code is 0 whatever they are. It is not a
// real phone, and the report says so. Nothing here prints a key, a password, a cookie, a URL or an e-mail address.
import { SetupError, assertTarget, nearestRank, summarize } from "./perf-order-entry";

/** Chrome DevTools' "Slow 4G" preset, as Network.emulateNetworkConditions takes it (throughput in bytes per second). */
export const SLOW_4G = {
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
} as const;

/** Loads of each kind. */
export const COLD_WARM_LOADS = 20;
/** The product's target. Printed next to the numbers, never compared with them. */
const TARGET_MS = 2000;

export const REAL_PHONE_SENTENCE =
  "Misurato su staging con rete simulata Slow 4G (Chromium), non da un telefono reale";

export const STAGING_ONLY_SENTENCE =
  "Refusing to run: this measurement is for the staging project and the configured staging app host only.";

/**
 * Both the Supabase project and the app must be the staging ones: the project by its exact host name, the app by the exact host in
 * `stagingAppHost` (no suffix, no port, https, no credentials). The message repeats nothing it was given. Returns the app's origin.
 */
export function assertStagingTarget(input: {
  supabaseUrl: string;
  baseUrl: string;
  stagingRef: string;
  stagingAppHost: string;
}): { baseOrigin: string } {
  if (!input.stagingRef || !input.stagingAppHost) throw new Error(STAGING_ONLY_SENTENCE);
  try {
    assertTarget({
      supabaseUrl: input.supabaseUrl,
      baseUrl: input.baseUrl,
      stagingRef: input.stagingRef,
    });
    const app = new URL(input.baseUrl);
    if (app.host !== input.stagingAppHost || app.port !== "") throw new Error("host");
    return { baseOrigin: app.origin };
  } catch {
    throw new Error(STAGING_ONLY_SENTENCE);
  }
}

// --- ports -------------------------------------------------------------------------------------------------------------------

export type LoadMode = "cold" | "warm";

export interface Perf4gPorts {
  /** Finds the fake perf owner, gives it a password for this run, signs in. Throws a SetupError with a fixed sentence. */
  provisionOwner(): Promise<void>;
  /**
   * One load of Oggi as the owner: from the start of the navigation to `[data-tile="yesterday"]` visible, in ms; null when the
   * tile did not show within the adapter's limit. "cold" is a fresh browser context (empty cache), "warm" a repeat visit.
   */
  load(mode: LoadMode): Promise<number | null>;
}

export interface Perf4gSamples {
  cold: number[];
  warm: number[];
  coldFailures: number;
  warmFailures: number;
}

/** Cold loads first, then warm ones, one at a time. A failed load is counted, never thrown: numbers do not stop a run. */
export async function measure(ports: Perf4gPorts): Promise<Perf4gSamples> {
  const samples: Perf4gSamples = { cold: [], warm: [], coldFailures: 0, warmFailures: 0 };
  for (const mode of ["cold", "warm"] as const) {
    for (let index = 0; index < COLD_WARM_LOADS; index += 1) {
      const ms = await ports.load(mode);
      if (ms === null) samples[mode === "cold" ? "coldFailures" : "warmFailures"] += 1;
      else samples[mode].push(ms);
    }
  }
  return samples;
}

// --- the report --------------------------------------------------------------------------------------------------------------

const ms = (value: number | null) => (value === null ? "–" : value.toFixed(1));

function row(label: string, values: readonly number[], failures: number): string {
  const s = summarize(values);
  return `| ${label} | ${s.n} | ${failures} | ${ms(nearestRank(values, 50))} | ${ms(nearestRank(values, 95))} | ${ms(s.max)} |`;
}

/** Markdown for the PR: fixed words and numbers only. */
export function renderReport(samples: Perf4gSamples): string {
  return [
    "## AT7 · Velocità del cruscotto su rete lenta",
    "",
    `${REAL_PHONE_SENTENCE}. Nessun valore è una promessa: l'obiettivo del prodotto è ${TARGET_MS / 1000} s su un telefono in 4G, e si verifica a parte su un telefono vero.`,
    "",
    `- Prova: ${COLD_WARM_LOADS} caricamenti a freddo (contesto nuovo, nessuna cache) e ${COLD_WARM_LOADS} a caldo (visita ripetuta), uno alla volta, come titolare del locale di prova.`,
    `- Rete simulata: latenza ${SLOW_4G.latency} ms, 1,6 Mbps in scarico, 750 Kbps in invio.`,
    '- Tempo in millisecondi, dall\'inizio della navigazione fino a quando il riquadro "Ieri" è visibile.',
    '- "Errori": caricamenti in cui il riquadro non è comparso nel tempo massimo (non sono nei tempi).',
    "",
    "| Caricamento | n | Errori | p50 ms | p95 ms | max ms |",
    "|---|---|---|---|---|---|",
    row("Primo caricamento (a freddo)", samples.cold, samples.coldFailures),
    row("Caricamenti successivi (a caldo)", samples.warm, samples.warmFailures),
    "",
  ].join("\n");
}

// --- the whole run -----------------------------------------------------------------------------------------------------------

export interface RunOptions {
  write: (text: string) => void;
  writeError?: (text: string) => void;
}

/**
 * Setup, measure, report. Returns the process exit code: 0 whatever the numbers are; 1 only when the setup cannot be done (nothing
 * is printed to `write` then, and the message is a fixed sentence: a SetupError's own text, or a generic one).
 */
export async function run(ports: Perf4gPorts, options: RunOptions): Promise<number> {
  try {
    await ports.provisionOwner();
    options.write(renderReport(await measure(ports)));
    return 0;
  } catch (error) {
    options.writeError?.(
      error instanceof SetupError
        ? error.message
        : "Setup: unexpected error before the measurement.",
    );
    return 1;
  }
}
