import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printTraceTails, SKIPPED_LINE } from "../../../scripts/lib/trace-tail";

// CI diagnostics (fix/e2e-exports-diagnostics): the Playwright report artifact cannot always be fetched, so a failed e2e job
// prints the tail of each failed test's trace.zip into the log. The fixture below follows the format of playwright-core 1.56.1
// (lib/server/trace/recorder/tracing.js): JSONL events `before` / `after` (callId), `event`, `console`, plus a .network file.

/** A minimal zip writer (stored entries, no compression), so the tests need no zip tool. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const plainSha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);
const idOf = (line: string | undefined) => /id=([0-9a-f]{8})$/.exec(line ?? "")?.[1];
const jsonl = (events: object[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trace-tail-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(testFolder: string, file: Buffer | string) {
  mkdirSync(join(root, testFolder), { recursive: true });
  writeFileSync(join(root, testFolder, "trace.zip"), file);
}
function run(): string[] {
  const out: string[] = [];
  printTraceTails(root, (line) => out.push(line));
  return out;
}

const call = (i: number, method = "click", extra: object = {}) => [
  {
    type: "before",
    callId: `call@${i}`,
    startTime: 1000 + i * 10,
    class: "Frame",
    method,
    params: {},
  },
  { type: "after", callId: `call@${i}`, endTime: 1005 + i * 10, ...extra },
];

describe("print-trace-tail", () => {
  it("prints the test folder name and the last 40 actions with method, times and error", () => {
    const events: object[] = [{ type: "context-options", version: 8, monotonicTime: 0 }];
    for (let i = 0; i < 60; i++)
      events.push(
        ...call(
          i,
          "click",
          i === 59
            ? { error: { name: "Error", message: "Test ended.\nCall log:\n - detail" } }
            : {},
        ),
      );
    put("exports-owner-phone", zip({ "0-trace.trace": jsonl(events), "0-trace.network": "" }));
    const out = run();
    expect(out[0]).toContain("exports-owner-phone");
    const actions = out.filter((l) => l.includes("Frame.click"));
    expect(actions).toHaveLength(40);
    expect(actions[0]).toContain("call@20");
    expect(actions.at(-1)).toContain("call@59");
    expect(actions.at(-1)).toContain("dur=5ms");
    expect(actions.at(-1)).toContain("error: Error: Test ended.");
    expect(actions.at(-1)).not.toContain("detail");
    expect(out.join("\n")).not.toContain("call@19");
  });

  it("marks an action that never ended", () => {
    put(
      "hang",
      zip({
        "0-trace.trace": jsonl([
          {
            type: "before",
            callId: "call@1",
            startTime: 5,
            class: "Page",
            method: "waitForEvent",
            params: {},
          },
        ]),
      }),
    );
    expect(run().join("\n")).toMatch(/Page\.waitForEvent.*end=none/);
  });

  it("merges the test runner's trace file with the context's, in time order", () => {
    put(
      "two-files",
      zip({
        "test.trace": jsonl([
          {
            type: "before",
            callId: "hook@1",
            startTime: 20,
            class: "Test",
            method: "step",
            title: "expect.toBeVisible",
            params: {},
          },
        ]),
        "0-trace.trace": jsonl([
          {
            type: "before",
            callId: "call@1",
            startTime: 10,
            class: "Frame",
            method: "goto",
            params: {},
          },
        ]),
      }),
    );
    const text = run().join("\n");
    expect(text.indexOf("Frame.goto")).toBeGreaterThan(-1);
    expect(text.indexOf("Frame.goto")).toBeLessThan(text.indexOf("Test.step"));
  });

  it("prints the last 30 console messages and page errors as kind, offset, length and fingerprint only", () => {
    const events: object[] = [];
    for (let i = 0; i < 45; i++)
      events.push({ type: "console", messageType: "error", text: `message ${i}`, time: 100 + i });
    events.push({
      type: "event",
      class: "BrowserContext",
      method: "pageError",
      time: 200,
      params: {
        error: { error: { name: "TypeError", message: "x is undefined", stack: "at secret.js:1" } },
      },
    });
    put("console", zip({ "0-trace.trace": jsonl(events) }));
    const out = run();
    const entries = out.filter((l) => /console\.error|pageerror/.test(l));
    expect(entries).toHaveLength(30);
    expect(entries.at(-1)).toMatch(
      /^ {2}\+\d+(\.\d+)?ms pageerror TypeError len=14 id=[0-9a-f]{8}$/,
    );
    expect(entries[0]).toMatch(/^ {2}\+16ms console\.error len=10 id=[0-9a-f]{8}$/);
    const text = out.join("\n");
    expect(text).not.toContain("message 16");
    expect(text).not.toContain("x is undefined");
    expect(text).not.toContain("secret.js");
  });

  it("prints no more than 200 lines for one test", () => {
    const events: object[] = [];
    for (let i = 0; i < 500; i++)
      events.push(...call(i), { type: "console", messageType: "log", text: `m${i}`, time: i });
    put("big", zip({ "0-trace.trace": jsonl(events) }));
    expect(run().length).toBeLessThanOrEqual(200);
  });

  it("prints none of the secrets a trace holds", () => {
    const events = [
      {
        type: "before",
        callId: "call@1",
        startTime: 1,
        class: "Frame",
        method: "fill",
        title: 'Fill "TYPEDVALUE"',
        params: { selector: "#pin", value: "TYPEDVALUE" },
      },
      {
        type: "after",
        callId: "call@1",
        endTime: 2,
        error: {
          name: "Error",
          message: "locator.fill: failed at http://localhost:3000/api/x?token=QUERYVALUE#frag",
        },
      },
      {
        type: "before",
        callId: "call@2",
        startTime: 3,
        class: "APIRequestContext",
        method: "fetch",
        title: "Fetch",
        params: {
          url: "http://localhost:3000/api/x?token=QUERYVALUE",
          method: "POST",
          postData: "BODYVALUE",
          headers: [
            { name: "cookie", value: "sb-session=COOKIEVALUE" },
            { name: "Authorization", value: "Bearer BEARERVALUE" },
          ],
        },
      },
      { type: "after", callId: "call@2", endTime: 4, result: { body: "RESPONSEBODY" } },
      {
        type: "console",
        messageType: "log",
        text: "went to http://localhost:3000/a?code=QUERYVALUE, /x?token=QUERYVALUE and Authorization: Bearer BEARERVALUE",
        location: { url: "http://localhost:3000/_next/x.js?v=QUERYVALUE" },
        time: 5,
      },
      {
        type: "event",
        class: "BrowserContext",
        method: "download",
        time: 6,
        params: {
          url: "http://localhost:3000/d?sig=QUERYVALUE",
          suggestedFilename: "FILENAME.csv",
        },
      },
      {
        type: "context-options",
        options: {
          storageState: { cookies: [{ name: "c", value: "COOKIEVALUE" }] },
          extraHTTPHeaders: { authorization: "BEARERVALUE" },
        },
      },
    ];
    const network = jsonl([
      {
        type: "resource-snapshot",
        snapshot: {
          request: {
            url: "http://x/?q=QUERYVALUE",
            headers: [{ name: "cookie", value: "COOKIEVALUE" }],
            postData: { text: "BODYVALUE" },
          },
        },
      },
    ]);
    put("secrets", zip({ "0-trace.trace": jsonl(events), "0-trace.network": network }));
    const text = run().join("\n");
    expect(text).toContain("Frame.fill");
    expect(text).toContain("APIRequestContext.fetch");
    for (const secret of [
      "TYPEDVALUE",
      "QUERYVALUE",
      "BODYVALUE",
      "COOKIEVALUE",
      "BEARERVALUE",
      "RESPONSEBODY",
      "FILENAME",
      "frag",
      "sb-session",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("prints a one-line notice for a corrupt zip, an empty zip and an empty file, and carries on", () => {
    put("a-corrupt", "this is not a zip");
    put("b-empty-file", "");
    put("c-empty-zip", zip({}));
    put("d-no-trace", zip({ "0-trace.network": "" }));
    put("e-good", zip({ "0-trace.trace": jsonl(call(1)) }));
    const out = run();
    for (const name of ["a-corrupt", "b-empty-file", "c-empty-zip", "d-no-trace"]) {
      const lines = out.filter((l) => l.includes(name));
      expect(lines, name).toHaveLength(1);
      expect(lines[0]).toMatch(/unreadable|no trace/);
    }
    expect(out.join("\n")).toContain("Frame.click");
  });

  it("skips a malformed JSONL line and says nothing is there when no trace.zip exists", () => {
    put("bad-line", zip({ "0-trace.trace": "{not json\n" + jsonl(call(1)) }));
    expect(run().join("\n")).toContain("Frame.click");
    rmSync(join(root, "bad-line"), { recursive: true });
    expect(run().join("\n")).toMatch(/no trace\.zip/);
  });
  it("prints only kind, length and fingerprint for console and page error text that holds a secret", () => {
    const secret = "sb-x-auth-token=base64-QUJD user owner@example.com Bearer ABC";
    put(
      "console-secret",
      zip({
        "0-trace.trace": jsonl([
          { type: "console", messageType: "log", text: secret, time: 5 },
          {
            type: "event",
            class: "BrowserContext",
            method: "pageError",
            time: 6,
            params: { error: { error: { name: "Secret value here", message: secret } } },
          },
        ]),
      }),
    );
    const out = run();
    const entries = out.filter((l) => /console\.log|pageerror/.test(l));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatch(
      new RegExp(`^ {2}\\+0ms console\\.log len=${secret.length} id=[0-9a-f]{8}$`),
    );
    expect(entries[1]).toMatch(
      new RegExp(`^ {2}\\+1ms pageerror len=${secret.length} id=[0-9a-f]{8}$`),
    );
    // The same text gives the same id within a run.
    expect(idOf(entries[0])).toBe(idOf(entries[1]));
    const text = out.join("\n");
    for (const part of ["auth-token", "base64", "owner", "Bearer", "Secret value"])
      expect(text, part).not.toContain(part);
  });

  it("makes the id of a call and the folder name safe to print", () => {
    put(
      "evil\nfolder \u001b[31m SECRETFOLDER=1",
      zip({
        "0-trace.trace": jsonl([
          {
            type: "before",
            callId: "call@1\nINJECTED line",
            startTime: 1,
            class: "Fr ame",
            method: "go\tto",
            params: {},
          },
        ]),
      }),
    );
    const out = run();
    expect(out.every((l) => !/[\u0000-\u0009\u000b-\u001f]/.test(l))).toBe(true);
    expect(out.join("\n")).not.toMatch(/^INJECTED/m);
    expect(out.join("\n")).toContain("call@1_INJECTED_line");
  });

  it("keeps the tail and the end times when the trace holds far more events than it keeps", () => {
    const events: object[] = [];
    for (let i = 0; i < 3000; i++) events.push(...call(i));
    put("long", zip({ "0-trace.trace": jsonl(events) }));
    const actions = run().filter((l) => l.includes("Frame.click"));
    expect(actions).toHaveLength(40);
    expect(actions.at(-1)).toContain("call@2999");
    expect(actions.at(-1)).toContain("dur=5ms");
  });

  it("does not print a typed value from the title of a test step", () => {
    put(
      "step",
      zip({
        "test.trace": jsonl([
          {
            type: "before",
            callId: "pw:api@1",
            startTime: 1,
            class: "Test",
            method: "step",
            title: 'Fill "TYPEDVALUE"',
            params: {},
          },
          {
            type: "before",
            callId: "expect@2",
            startTime: 2,
            class: "Test",
            method: "step",
            title: "expect.toBeVisible",
            params: {},
          },
        ]),
      }),
    );
    const text = run().join("\n");
    expect(text).toContain("Test.step expect.toBeVisible");
    expect(text).toContain("pw_api@1 Test.step");
    expect(text).not.toContain("TYPEDVALUE");
    expect(text).not.toContain("Fill");
  });

  it("prints the name of an error only when it looks like an error class", () => {
    put(
      "names",
      zip({
        "0-trace.trace": jsonl([
          ...call(1, "click", { error: { name: "TimeoutError", message: "waited" } }),
          ...call(2, "click", { error: { name: "my secret name", message: "waited" } }),
        ]),
      }),
    );
    const text = run().join("\n");
    expect(text).toContain("error: TimeoutError: waited");
    expect(text).toContain("error: waited");
    expect(text).not.toContain("secret name");
  });
});

// Each case is built so that only its own rule in scrub() removes the value: the other rules must not match it. The error message
// of an action is the carrier (Playwright's own error texts are templated; a value can still reach them).
describe("the first line of an action error is scrubbed", () => {
  function printedError(message: string): string {
    put(
      "scrub",
      zip({ "0-trace.trace": jsonl(call(1, "click", { error: { name: "Error", message } })) }),
    );
    const line = run().find((l) => l.includes("call@1"));
    expect(line).toBeDefined();
    return line!.slice(line!.indexOf("error: "));
  }
  const gone = (message: string, ...values: string[]) => {
    const printed = printedError(message);
    for (const value of values) expect(printed, value).not.toContain(value);
    return printed;
  };

  it("keeps a plain first line and drops the rest", () => {
    expect(printedError("Timeout 5000ms exceeded.\nCall log:\n - fill(SECONDLINE)")).toBe(
      "error: Error: Timeout 5000ms exceeded.",
    );
  });
  it("caps the message at 200 characters", () => {
    const printed = printedError("abc ".repeat(200));
    expect(printed.length).toBe("error: Error: ".length + 200);
  });
  it("removes ANSI codes", () => {
    expect(printedError("\u001b[31mTimeout\u001b[39m exceeded")).toBe(
      "error: Error: Timeout exceeded",
    );
  });
  it("removes a bare JWT", () => {
    gone("got eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbg here", "eyJ", "c2lnbg");
  });
  it("removes an undotted base64 run of 32 characters or more", () => {
    gone("got ZmFrZXNlY3JldHZhbHVlMTIzNDU2Nzg5MDEyMzQ1Ng here", "ZmFrZXNl");
  });
  it("removes a base64- cookie value", () => {
    gone("set sb-localhost-auth-token.0=base64-QUJDREVGRw here", "QUJDREVGRw");
  });
  it("removes the value of a quoted JSON pair, whatever the key", () => {
    gone('body {"session":"JSONVALUE","n":1}', "JSONVALUE");
  });
  it("removes a quoted JSON apikey", () => {
    gone('body {"apikey":"APIKEYVALUE"}', "APIKEYVALUE");
  });
  it.each(["sb_secret_ABCDEF1234", "sb_publishable_ABCDEF1234"])("removes %s", (key) => {
    gone(`key ${key} used`, "ABCDEF1234");
  });
  it.each([
    "password",
    "pass",
    "pwd",
    "token",
    "secret",
    "refresh_token",
    "access_token",
    "apikey",
    "api_key",
    "x-api-key",
  ])("removes the value after %s=", (key) => {
    gone(`failed ${key}=KEYVALUE1 again`, "KEYVALUE1");
    gone(`failed ${key}: KEYVALUE1 again`, "KEYVALUE1");
  });
  it.each(["authorization", "cookie", "set-cookie"])(
    "removes the rest of the line after %s:",
    (key) => {
      gone(`sent ${key}: sessionid=HEADERVALUE; theme=dark`, "HEADERVALUE", "theme");
    },
  );
  it("removes a query that starts a word", () => {
    gone("opened ?code=QUERYVALUE now", "QUERYVALUE");
  });
  it("removes a query after a path", () => {
    gone("opened /x/y?mode=QUERYVALUE now", "QUERYVALUE");
  });
  it("removes a fragment", () => {
    gone("opened /x/y#FRAGVALUE now", "FRAGVALUE");
  });
  it.each([
    "CRON_SECRET",
    "RESERVATION_GATE_KEY",
    "PIN_PEPPER",
    "pin",
    "SESSION_TOKEN",
    "DB_PASSWORD",
  ])("removes the value after %s=, where the key ends a longer name", (key) => {
    gone(`env ${key}=ENVVALUE1 loaded`, "ENVVALUE1");
    gone(`env ${key.toLowerCase()}: ENVVALUE1 loaded`, "ENVVALUE1");
  });
  it("removes the value that follows x-api-key with no separator", () => {
    gone("sent x-api-key XAPIVALUE1 now", "XAPIVALUE1");
  });
  it("keeps only the first line, whichever way it ends (a carriage return cannot start a log command)", () => {
    const printed = gone("error\r::warning::INJECTED", "::warning::", "INJECTED");
    expect(printed).toBe("error: Error: error");
  });
  it("splits on a lone line feed too", () => {
    gone("error\n::warning::INJECTED", "INJECTED");
  });
  it("replaces any other control character", () => {
    const printed = printedError("bad\u0007bell\u0000nul\u000bvt\u2028ls end");
    expect(printed).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(printed).toContain("end");
  });
  it("removes an e-mail address", () => {
    gone("user owner@example.com not found", "owner", "example.com");
  });
  it.each(["Bearer BEARERVALUE1", "Basic BASICVALUE1"])(
    "removes the credential after %s",
    (credential) => {
      gone(`sent ${credential} to server`, "VALUE1");
    },
  );
});

describe("the fingerprint of a console message", () => {
  const consoleZip = (text: string) =>
    zip({ "0-trace.trace": jsonl([{ type: "console", messageType: "log", text, time: 1 }]) });

  it("is the same twice in one run, differs between texts, and is not the plain sha256", () => {
    put("a", consoleZip("same text"));
    put("b", consoleZip("same text"));
    put("c", consoleZip("other text"));
    const out = run();
    const ids = out.filter((l) => l.includes("console.log")).map(idOf);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[0]).not.toBe(plainSha("same text"));
  });

  it("differs between two runs of the script for the same text (a random key per run)", async () => {
    put("a", consoleZip("same text"));
    const idInFreshRun = async () => {
      vi.resetModules();
      const fresh = await import("../../../scripts/lib/trace-tail");
      const out: string[] = [];
      fresh.printTraceTails(root, (line) => out.push(line));
      return idOf(out.find((l) => l.includes("console.log")));
    };
    const first = await idInFreshRun();
    const second = await idInFreshRun();
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(second).toMatch(/^[0-9a-f]{8}$/);
    expect(second).not.toBe(first);
  });
});

describe("what is kept while a trace is read", () => {
  // Events are kept by arrival order (the newest 500 per file, 100 console entries), so a descending-time file shows the cap:
  // the earliest arrivals, which are the latest in time, are dropped.
  it("keeps the newest 500 events of a file", () => {
    const events: object[] = [];
    for (let i = 0; i < 600; i++)
      events.push({ type: "event", class: "BrowserContext", method: "page", time: 1000 - i });
    put("events", zip({ "0-trace.trace": jsonl(events) }));
    const offsets = run()
      .filter((l) => l.includes("BrowserContext.page"))
      .map((l) => Number(/at=\+(\d+)ms/.exec(l)?.[1]));
    expect(offsets).toHaveLength(40);
    expect(Math.max(...offsets)).toBe(499); // 600 kept would reach 599
  });

  it("keeps the newest 100 console messages of a file", () => {
    const events: object[] = [];
    for (let i = 0; i < 150; i++)
      events.push({ type: "console", messageType: "log", text: `m${i}`, time: 1000 - i });
    put("console-cap", zip({ "0-trace.trace": jsonl(events) }));
    const offsets = run()
      .filter((l) => l.includes("console.log"))
      .map((l) => Number(/\+(\d+)ms/.exec(l)?.[1]));
    expect(offsets).toHaveLength(30);
    expect(Math.max(...offsets)).toBe(99); // 150 kept would reach 149
  });

  it("never parses the large snapshot lines, and parses the lines that matter", () => {
    for (const type of ["frame-snapshot", "resource-snapshot", "screencast-frame", "input", "log"])
      expect(SKIPPED_LINE.test(`{"type":"${type}","callId":"x"}`), type).toBe(true);
    for (const type of ["before", "after", "event", "console", "context-options"])
      expect(SKIPPED_LINE.test(`{"type":"${type}","callId":"x"}`), type).toBe(false);
    // A line that merely mentions a skipped type later on is not skipped.
    expect(SKIPPED_LINE.test('{"callId":"x","type":"log"}')).toBe(false);
  });
});
