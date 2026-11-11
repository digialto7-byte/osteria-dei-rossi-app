// CI diagnostics: prints the tail of each failed Playwright test's trace.zip into the job log, for when the report artifact
// cannot be downloaded. Format read from playwright-core 1.56.1 (lib/server/trace/recorder/tracing.js): a zip with `*.trace`
// JSONL files (context: `0-trace.trace`, test runner: `test.trace`), a `*.network` file and resources.
//
// What is printed, and nothing else:
//   - the test's folder name and each call id, class and method, passed through safeId() (letters, digits, `_ . @ / -` only);
//   - times, durations and counts;
//   - for an action that failed: the error's name (only when it looks like an error class) and the first line of its message,
//     which Playwright's own error texts template but a value can still reach, so it goes through scrub() (best effort: a
//     list of patterns, not a guarantee) and is cut to 200 characters;
//   - a test step's title, only when it is a bare identifier such as `expect.toBeVisible`;
//   - for each console message and page error: its offset, kind, text length and a fingerprint (first 8 hex of an HMAC-SHA256 of the
//     text, keyed with a random per-run key that is never printed), plus a page error's name when it looks like an error class. The text itself is never printed.
// Never printed: params (selectors, fill values, URLs, headers, post data), other titles (`Fill "value"`), results, stacks,
// storageState, console and page error text. The `.network` file is never read (only `*.trace` entries are passed to unzip).
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const MAX_ACTIONS = 40;
const MAX_CONSOLE = 30;
const MAX_LINES_PER_TEST = 200;
const MAX_ERROR_TEXT = 200;
const MAX_ID = 80;
const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const UNZIP_TIMEOUT_MS = 60_000;
// Parsed events kept while a trace file is read line by line (the newest ones): more than are printed, so the merge of the
// context's and the test runner's files in time order still finds the true tail.
const KEEP_ACTIONS = 500;
const KEEP_EVENTS = 500;
const KEEP_CONSOLE = 100;
// Only plain names of `.trace` entries are ever passed to unzip: no wildcard characters, no path, no leading `-`.
const TRACE_ENTRY = /^\w[\w.-]*\.trace$/;
// Trace lines that are large and not needed here: never parsed.
export const SKIPPED_LINE =
  /^\{"type":"(frame-snapshot|resource-snapshot|screencast-frame|input|log)"/;
const ERROR_NAME = /^(?:[A-Z][A-Za-z]*)?Error$/;

type Raw = Record<string, unknown>;
type Row = { time: number; text: (t0: number) => string };
type Action = {
  time: number;
  callId: string;
  cls: string;
  method: string;
  title: string;
  end?: number;
  error?: unknown;
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null ? (value as Raw) : {};

/** An id made safe to print: no newline or control character, nothing outside `[\w.@/-]`, short. */
export function safeId(value: string): string {
  return value.replace(/[^\w.@/-]/g, "_").slice(0, MAX_ID);
}

// A random key per run of the script (never printed): the same text gets the same id within a run, so repeats group, but an id
// cannot be checked offline against a guessed value.
const FINGERPRINT_KEY = randomBytes(32);
const fingerprint = (text: string) =>
  createHmac("sha256", FINGERPRINT_KEY).update(text).digest("hex").slice(0, 8);

// Best effort, in this order. Each rule has its own test (tests/scripts/ci/print-trace-tail.test.ts).
// A key may end a longer name (CRON_SECRET, PIN_PEPPER, refresh_token, RESERVATION_GATE_KEY, api_key).
const KEYS = "secret|token|key|pin|password|pass|pwd|pepper";
const HEADERS = "authorization|cookie|set-cookie";
const RULES: [RegExp, string][] = [
  [/\u001b\[[0-9;?]*[A-Za-z]/g, ""], // ansi
  [/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " "], // control
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[redacted]"], // jwt
  [/\bbase64-[\w+/=-]+/g, "[redacted]"], // base64-cookie
  [/("[^"\\]{1,60}"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"[redacted]"'], // json-pair
  [/\bsb_(?:secret|publishable)_\w+/g, "[redacted]"], // sb-key
  [new RegExp(`\\b(${HEADERS})\\b["']?\\s*[:=].*`, "gi"), "$1: [redacted]"], // header
  [
    new RegExp(`\\b(\\w*(?:${KEYS}))\\b["']?\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|\\S+)`, "gi"),
    "$1=[redacted]",
  ], // key-value
  [/\bx-api-key\s+\S+/gi, "x-api-key [redacted]"], // x-api-key-bare
  [/\b(?:Bearer|Basic)\s+\S+/gi, "[redacted]"], // bearer-basic
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[redacted]"], // email
  [/\?[^\s"'<>)]*/g, ""], // query
  [/(?<=\S)#[^\s"'<>)]*/g, ""], // fragment
  [/[A-Za-z0-9_+/-]{32,}={0,2}/g, "[redacted]"], // long-run
];

/** Free text made safe to print: first line only, credentials and URL queries removed, 200 characters at most. */
export function scrub(text: string): string {
  // The first line only: a lone \r also ends it (a log command could follow it). The cut before the rules bounds their work.
  let out = (text.split(/[\r\n]/)[0] ?? "").slice(0, 4000);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.slice(0, MAX_ERROR_TEXT);
}

const ms = (value: number) => `${Math.round(value * 10) / 10}`;

// A test-runner step's title can carry a typed value (`Fill "x"`), so it is printed only when it is a bare identifier
// such as `expect.toBeVisible`.
const safeTitle = (title: string) => (/^[A-Za-z][\w.]*$/.test(title) ? ` ${title}` : "");

/** The error's name (only when it looks like an error class) and the scrubbed first line of its message. */
function errorText(error: unknown): string {
  const e = obj(error);
  const name = ERROR_NAME.test(str(e.name)) ? `${str(e.name)}: ` : "";
  const message = scrub(str(e.message));
  return message ? `${name}${message}` : "(no message)";
}

/** Keeps the newest `max` items of a stream, oldest dropped first. */
function keepLast<T>(list: T[], max: number, onDrop?: (item: T) => void): void {
  while (list.length > max) {
    const dropped = list.shift() as T;
    onDrop?.(dropped);
  }
}

type Parsed = { actions: Action[]; events: Row[]; consoles: Row[]; first: number };

/** One `.trace` file, read line by line; only the newest events of each kind are kept. */
function parseTrace(text: string, parsed: Parsed): void {
  const open = new Map<string, Action>();
  const actions: Action[] = [];
  const seen = (time: number) => {
    if (time > 0 && time < parsed.first) parsed.first = time;
  };
  let from = 0;
  while (from < text.length) {
    let to = text.indexOf("\n", from);
    if (to === -1) to = text.length;
    const line = text.slice(from, to);
    from = to + 1;
    if (!line.trim() || SKIPPED_LINE.test(line)) continue;
    let e: Raw;
    try {
      const event: unknown = JSON.parse(line);
      if (typeof event !== "object" || event === null) continue;
      e = event as Raw;
    } catch {
      continue; // A line cut off by a crash or a kill: skip it, keep the rest.
    }
    if (e.type === "before") {
      const time = num(e.startTime);
      if (time === undefined) continue;
      seen(time);
      const action: Action = {
        time,
        callId: str(e.callId),
        cls: str(e.class),
        method: str(e.method),
        title: e.class === "Test" ? str(e.title) : "",
      };
      actions.push(action);
      open.set(action.callId, action);
      keepLast(actions, KEEP_ACTIONS, (dropped) => open.delete(dropped.callId));
    } else if (e.type === "after") {
      const action = open.get(str(e.callId));
      if (action) {
        action.end = num(e.endTime);
        action.error = e.error;
      }
    } else if (e.type === "event") {
      const time = num(e.time);
      if (time === undefined) continue;
      seen(time);
      const method = str(e.method);
      if (method === "pageError") {
        const inner = obj(obj(obj(e.params).error).error);
        const message = str(inner.message);
        const name = ERROR_NAME.test(str(inner.name)) ? ` ${str(inner.name)}` : "";
        parsed.consoles.push({
          time,
          text: (t0) =>
            `  +${ms(time - t0)}ms pageerror${name} len=${message.length} id=${fingerprint(message)}`,
        });
        keepLast(parsed.consoles, KEEP_CONSOLE);
      } else {
        parsed.events.push({
          time,
          text: (t0) => `  event ${safeId(str(e.class))}.${safeId(method)} at=+${ms(time - t0)}ms`,
        });
        keepLast(parsed.events, KEEP_EVENTS);
      }
    } else if (e.type === "console") {
      const time = num(e.time);
      if (time === undefined) continue;
      seen(time);
      const text = str(e.text);
      const kind = safeId(str(e.messageType) || "log");
      parsed.consoles.push({
        time,
        text: (t0) =>
          `  +${ms(time - t0)}ms console.${kind} len=${text.length} id=${fingerprint(text)}`,
      });
      keepLast(parsed.consoles, KEEP_CONSOLE);
    }
  }
  parsed.actions.push(...actions);
}

/** Pure: the report lines for one test, from the contents of its `.trace` files. */
export function formatTrace(testName: string, traceTexts: string[]): string[] {
  const name = safeId(testName);
  const parsed: Parsed = { actions: [], events: [], consoles: [], first: Infinity };
  for (const text of traceTexts) parseTrace(text, parsed);

  const t0 = Number.isFinite(parsed.first) ? parsed.first : 0;
  const rows: Row[] = [
    ...parsed.actions.map((a) => ({
      time: a.time,
      text: (zero: number) =>
        `  ${safeId(a.callId)} ${safeId(a.cls)}.${safeId(a.method)}${safeTitle(a.title)}` +
        ` start=+${ms(a.time - zero)}ms ` +
        (a.end === undefined
          ? "end=none (unfinished)"
          : `end=+${ms(a.end - zero)}ms dur=${ms(a.end - a.time)}ms`) +
        (a.error ? ` error: ${errorText(a.error)}` : ""),
    })),
    ...parsed.events,
  ];
  const tail = (list: Row[], n: number) =>
    list
      .sort((a, b) => a.time - b.time)
      .slice(-n)
      .map((r) => r.text(t0));
  const lines = [
    `--- ${name}: last actions and events (times in ms from the first event) ---`,
    ...tail(rows, MAX_ACTIONS),
    `--- ${name}: last console messages and page errors (kind, length, fingerprint only) ---`,
    ...tail(parsed.consoles, MAX_CONSOLE),
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
  const options = { encoding: "utf8", timeout: UNZIP_TIMEOUT_MS } as const;
  const list = spawnSync("unzip", ["-Z1", zipPath], { ...options, maxBuffer: 16 * 1024 * 1024 });
  if (list.error) throw list.error;
  if (list.status !== 0) throw new Error(`unzip exited with ${list.status}`);
  const names = list.stdout.split("\n").filter((n) => TRACE_ENTRY.test(n));
  return names.map((name) => {
    const read = spawnSync("unzip", ["-p", zipPath, name], {
      ...options,
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
    write(`no trace.zip under ${safeId(root)}`);
    return;
  }
  for (const zipPath of zips) {
    const name = safeId(basename(dirname(zipPath)));
    try {
      const texts = readTraceTexts(zipPath);
      if (texts.length === 0) {
        write(`${name}: no trace file in trace.zip`);
        continue;
      }
      for (const line of formatTrace(name, texts)) write(line);
    } catch (error) {
      // Only the error's code or class: an exception message could carry a path or output.
      const code =
        error instanceof Error ? str((error as { code?: unknown }).code) || error.name : "error";
      write(`${name}: trace.zip unreadable (${safeId(code)})`);
    }
  }
}
