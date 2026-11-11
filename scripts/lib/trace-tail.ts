// CI diagnostics: prints the tail of each failed Playwright test's trace.zip into the job log, for when the report artifact
// cannot be downloaded. Format read from playwright-core 1.56.1 (lib/server/trace/recorder/tracing.js): a zip with `*.trace`
// JSONL files (context: `0-trace.trace`, test runner: `test.trace`), a `*.network` file and resources.
//
// Redaction (strict, whatever the data): only ids, class.method names, times, durations and error messages are printed.
// Never printed: params (selectors, fill values, URLs, headers, post data), titles (`Fill "value"`), result bodies,
// stacks, storageState, the .network file (never even read). Free text that is printed (an error's first line, a console
// text) loses URL query strings and fragments and anything that looks like a credential, and is cut to a fixed length.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const MAX_ACTIONS = 40;
const MAX_CONSOLE = 30;
const MAX_LINES_PER_TEST = 200;
const MAX_TEXT = 300;
const MAX_TRACE_BYTES = 512 * 1024 * 1024;
// Only plain file names of `.trace` entries are ever passed to unzip (no wildcard characters, no paths).
const TRACE_ENTRY = /^[\w.-]+\.trace$/;

type Raw = Record<string, unknown>;
type Row = { time: number; text: (t0: number) => string };

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null ? (value as Raw) : {};

/** Free text made safe to print: first line only, no ANSI, no query strings or fragments, no credentials, short. */
export function scrub(text: string): string {
  const first = text.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)[0] ?? "";
  return (
    first
      // Any query string or fragment, absolute or relative URL: from the first ? or # inside a word to its end.
      .replace(/([^\s?#"'<>)])[?#][^\s"'<>)]*/g, "$1")
      .replace(
        /\b(authorization|cookie|set-cookie|apikey|x-api-key)\b\s*[:=]\s*.*/gi,
        "$1: [redacted]",
      )
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[redacted]")
      .slice(0, MAX_TEXT)
  );
}

const ms = (value: number) => `${Math.round(value * 10) / 10}`;

// A test-runner step's title can carry a typed value (`Fill "x"`), so it is printed only when it is a bare identifier
// such as `expect.toBeVisible`.
const safeTitle = (title: string) => (/^[A-Za-z][\w.]*$/.test(title) ? ` ${title}` : "");

function errorText(error: unknown): string {
  const outer = obj(error);
  // A serialized page error nests the error object: `{ error: { name, message, stack } }`.
  const e = typeof outer.message === "string" ? outer : obj(outer.error);
  const message = scrub(str(e.message));
  return message ? `${str(e.name) ? `${scrub(str(e.name))}: ` : ""}${message}` : "(no message)";
}

/** Pure: the report lines for one test, from the contents of its `.trace` files. */
export function formatTrace(testName: string, traceTexts: string[]): string[] {
  const events: Raw[] = [];
  for (const text of traceTexts) {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event: unknown = JSON.parse(line);
        if (typeof event === "object" && event !== null) events.push(event as Raw);
      } catch {
        // A line cut off by a crash or a kill: skip it, keep the rest.
      }
    }
  }

  const afters = new Map<string, Raw>();
  for (const e of events) if (e.type === "after" && str(e.callId)) afters.set(str(e.callId), e);

  const actions: Row[] = [];
  const consoles: Row[] = [];
  let first = Infinity;
  const seen = (time: number | undefined) => {
    if (time !== undefined && time > 0 && time < first) first = time;
  };

  for (const e of events) {
    if (e.type === "before") {
      const start = num(e.startTime);
      if (start === undefined) continue;
      seen(start);
      const after = afters.get(str(e.callId));
      const end = num(after?.endTime);
      const error = after?.error;
      actions.push({
        time: start,
        text: (t0) =>
          `  ${str(e.callId)} ${scrub(str(e.class))}.${scrub(str(e.method))}${e.class === "Test" ? safeTitle(str(e.title)) : ""}` +
          ` start=+${ms(start - t0)}ms ` +
          (end === undefined
            ? "end=none (unfinished)"
            : `end=+${ms(end - t0)}ms dur=${ms(end - start)}ms`) +
          (error ? ` error: ${errorText(error)}` : ""),
      });
    } else if (e.type === "event") {
      const time = num(e.time);
      if (time === undefined) continue;
      seen(time);
      const method = scrub(str(e.method));
      if (method === "pageError") {
        consoles.push({
          time,
          text: (t0) => `  +${ms(time - t0)}ms pageerror ${errorText(obj(e.params).error)}`,
        });
      } else {
        actions.push({
          time,
          text: (t0) => `  event ${scrub(str(e.class))}.${method} at=+${ms(time - t0)}ms`,
        });
      }
    } else if (e.type === "console") {
      const time = num(e.time);
      if (time === undefined) continue;
      seen(time);
      consoles.push({
        time,
        text: (t0) =>
          `  +${ms(time - t0)}ms console.${scrub(str(e.messageType))} ${scrub(str(e.text))}`,
      });
    }
  }

  const t0 = Number.isFinite(first) ? first : 0;
  const byTime = (a: Row, b: Row) => a.time - b.time;
  const tail = (rows: Row[], n: number) =>
    rows
      .sort(byTime)
      .slice(-n)
      .map((r) => r.text(t0));
  const lines = [
    `--- ${testName}: last actions and events (times in ms from the first event) ---`,
    ...tail(actions, MAX_ACTIONS),
    `--- ${testName}: last console messages and page errors ---`,
    ...tail(consoles, MAX_CONSOLE),
  ];
  return lines.slice(0, MAX_LINES_PER_TEST);
}

/** Every `trace.zip` below `root`, sorted. */
export function findTraceZips(root: string): string[] {
  try {
    return readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((p) => basename(p) === "trace.zip")
      .map((p) => join(root, p))
      .sort();
  } catch {
    return [];
  }
}

/** The text of each `*.trace` entry of the zip (never the .network file). Throws when the zip cannot be read. */
export function readTraceTexts(zipPath: string): string[] {
  const list = spawnSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (list.error) throw list.error;
  if (list.status !== 0) throw new Error(`unzip exited with ${list.status}`);
  const names = list.stdout.split("\n").filter((n) => TRACE_ENTRY.test(n));
  return names.map((name) => {
    const read = spawnSync("unzip", ["-p", zipPath, name], {
      encoding: "utf8",
      maxBuffer: MAX_TRACE_BYTES,
    });
    if (read.error) throw read.error;
    if (read.status !== 0) throw new Error(`unzip exited with ${read.status}`);
    return read.stdout;
  });
}

/** Prints the report for every trace.zip below `root`. Never throws: an unreadable zip becomes a one-line notice. */
export function printTraceTails(root: string, write: (line: string) => void): void {
  const zips = findTraceZips(root);
  if (zips.length === 0) {
    write(`no trace.zip under ${root}`);
    return;
  }
  for (const zipPath of zips) {
    const name = basename(dirname(zipPath));
    try {
      const texts = readTraceTexts(zipPath);
      if (texts.length === 0) {
        write(`${name}: no trace file in trace.zip`);
        continue;
      }
      for (const line of formatTrace(name, texts)) write(line);
    } catch (error) {
      write(
        `${name}: trace.zip unreadable (${scrub(error instanceof Error ? error.message : String(error))})`,
      );
    }
  }
}
