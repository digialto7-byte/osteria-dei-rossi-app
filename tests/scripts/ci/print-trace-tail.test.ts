import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { printTraceTails } from "../../../scripts/lib/trace-tail";

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

  it("prints the last 30 console messages and page errors", () => {
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
    expect(entries.at(-1)).toContain("pageerror");
    expect(entries.at(-1)).toContain("TypeError: x is undefined");
    expect(entries.at(-1)).not.toContain("secret.js");
    expect(entries[0]).toContain("message 16");
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
});
