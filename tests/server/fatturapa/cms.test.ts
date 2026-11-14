import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unwrapP7m } from "@/server/fatturapa/cms";
import { CMS_MAX_DEPTH, CMS_MAX_TLVS } from "@/server/fatturapa/constants";
import { FatturaError } from "@/server/fatturapa/errors";
import {
  OID_ENVELOPED_DATA,
  buildSignedData,
  deepIndefinite,
  indefinite,
  seeded,
  toBase64Lines,
  toPem,
} from "../../fixtures/fatturapa/build-cms";

const enc = new TextEncoder();
const XML = enc.encode(
  '<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica versione="FPR12"/>',
);

function reasonOf(bytes: Uint8Array): string {
  try {
    unwrapP7m(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(FatturaError);
    expect((error as FatturaError).code).toBe("p7m_unreadable");
    return (error as FatturaError).reason;
  }
  throw new Error("expected the unwrap to throw");
}

describe("unwrapP7m", () => {
  it("returns the exact eContent of a definite-length DER envelope", () => {
    expect(unwrapP7m(buildSignedData({ content: XML }))).toEqual(XML);
  });

  it("concatenates the chunks of a BER envelope with indefinite lengths", () => {
    const big = new Uint8Array(1000).map((_, i) => 0x41 + (i % 26));
    expect(unwrapP7m(buildSignedData({ content: big, ber: { chunk: 7 } }))).toEqual(big);
  });

  it("reads base64 text, wrapped and unwrapped, and PEM armour, to the same bytes", () => {
    const der = buildSignedData({ content: XML });
    expect(unwrapP7m(enc.encode(Buffer.from(der).toString("base64")))).toEqual(XML);
    expect(unwrapP7m(enc.encode(toBase64Lines(der, 76)))).toEqual(XML);
    expect(unwrapP7m(enc.encode(toPem(der)))).toEqual(XML);
  });

  it("opens an envelope inside an envelope", () => {
    const inner = buildSignedData({ content: XML });
    const twice = buildSignedData({ content: inner });
    const thrice = buildSignedData({ content: twice, ber: { chunk: 50 } });
    expect(unwrapP7m(twice)).toEqual(XML);
    expect(unwrapP7m(thrice)).toEqual(XML);
  });

  it("refuses a fourth level", () => {
    let bytes: Uint8Array = XML;
    for (let level = 0; level < 4; level += 1) bytes = buildSignedData({ content: bytes });
    expect(reasonOf(bytes)).toBe("nesting");
  });

  it("refuses a detached signature, naming the reason", () => {
    expect(reasonOf(buildSignedData({ content: null }))).toBe("detached");
  });

  it("refuses an envelopedData and an eContentType that is not id-data", () => {
    expect(reasonOf(buildSignedData({ contentInfoOid: OID_ENVELOPED_DATA }))).toBe("content_type");
    expect(reasonOf(buildSignedData({ eContentType: OID_ENVELOPED_DATA }))).toBe("content_type");
  });

  it("does not verify the signature: a corrupted signature value still unwraps", () => {
    const good = buildSignedData({ content: XML, signature: [1, 2, 3, 4] });
    const bad = buildSignedData({ content: XML, signature: [9, 9, 9, 9] });
    expect(unwrapP7m(bad)).toEqual(unwrapP7m(good));
  });

  it("tolerates trailing newlines and zeros but not other trailing bytes", () => {
    const der = buildSignedData({ content: XML });
    expect(unwrapP7m(Uint8Array.from([...der, 0x0a, 0x00, 0x0d]))).toEqual(XML);
    expect(reasonOf(Uint8Array.from([...der, 0x41]))).toBe("trailing");
  });
});

describe("unwrapP7m refuses a hostile structure", () => {
  it("a length written in five bytes", () => {
    expect(reasonOf(Uint8Array.from([0x30, 0x85, 0x00, 0x00, 0x00, 0x00, 0x05, 0x05, 0x00]))).toBe(
      "length",
    );
  });

  it("a length beyond the input", () => {
    expect(reasonOf(Uint8Array.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff, 0x05, 0x00]))).toBe(
      "length",
    );
  });

  it("an indefinite length on a primitive type", () => {
    expect(reasonOf(Uint8Array.from([0x30, 0x80, 0x04, 0x80, 0x00, 0x00, 0x00, 0x00]))).toBe(
      "structure",
    );
  });

  it("an indefinite length that is never closed", () => {
    expect(reasonOf(Uint8Array.from([0x30, 0x80, 0x05, 0x00]))).toBe("structure");
  });

  it("a high tag number", () => {
    expect(reasonOf(Uint8Array.from([0x30, 0x03, 0x1f, 0x81, 0x00]))).toBe("structure");
  });

  it(`a nesting of ${CMS_MAX_DEPTH + 1} indefinite levels, and accepts ${CMS_MAX_DEPTH} as far as the structure check`, () => {
    expect(reasonOf(deepIndefinite(CMS_MAX_DEPTH + 1))).toBe("depth");
    expect(reasonOf(deepIndefinite(CMS_MAX_DEPTH))).not.toBe("depth");
  });

  it(`more than ${CMS_MAX_TLVS} TLVs, and accepts exactly ${CMS_MAX_TLVS}`, () => {
    const nulls = (n: number) =>
      indefinite(
        0x30,
        new Array<number>(n).fill(0).flatMap(() => [0x05, 0x00]),
      );
    expect(reasonOf(Uint8Array.from(nulls(CMS_MAX_TLVS)))).toBe("limits");
    expect(reasonOf(Uint8Array.from(nulls(CMS_MAX_TLVS - 1)))).not.toBe("limits");
  });

  it("text that is not base64, and base64 with a stray character", () => {
    expect(reasonOf(enc.encode("this is not base64 at all!"))).toBe("encoding");
    expect(reasonOf(enc.encode(`${Buffer.from(buildSignedData()).toString("base64")}!`))).toBe(
      "encoding",
    );
    expect(reasonOf(enc.encode("-----BEGIN PKCS7-----\nAAAA\n"))).toBe("encoding");
  });

  it("empty input", () => {
    expect(reasonOf(new Uint8Array())).toBe("encoding");
  });

  it("a long run of white space followed by a bad character is refused without delay", () => {
    const started = Date.now();
    expect(reasonOf(enc.encode(`AAAA${" ".repeat(2_000_000)}!`))).toBe("encoding");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("unwrapP7m never throws anything but FatturaError", () => {
  const valid = buildSignedData({ content: XML });
  const validBer = buildSignedData({ content: XML, ber: { chunk: 9 } });

  it.each([
    ["DER", valid],
    ["BER", validBer],
  ])("every truncation of a valid %s file is refused", (_name, bytes) => {
    for (let cut = 0; cut < bytes.length; cut += 1) {
      const head = bytes.subarray(0, cut);
      try {
        unwrapP7m(head);
        throw new Error(`a truncation at ${cut} was accepted`);
      } catch (error) {
        expect(error).toBeInstanceOf(FatturaError);
      }
    }
  });

  it("1 000 seeded random inputs and mutations end in bytes or a FatturaError", () => {
    const random = seeded(20261114);
    for (let n = 0; n < 1000; n += 1) {
      let input: Uint8Array;
      if (n % 2 === 0) {
        input = Uint8Array.from({ length: Math.floor(random() * 300) }, () =>
          Math.floor(random() * 256),
        );
        if (n % 4 === 0 && input.length > 4) input[0] = 0x30; // look like an envelope more often
      } else {
        input = Uint8Array.from(n % 3 === 0 ? validBer : valid);
        for (let flips = 1 + Math.floor(random() * 4); flips > 0; flips -= 1) {
          input[Math.floor(random() * input.length)] = Math.floor(random() * 256);
        }
      }
      try {
        const out = unwrapP7m(input);
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out.length).toBeLessThanOrEqual(input.length);
      } catch (error) {
        expect(error).toBeInstanceOf(FatturaError);
      }
    }
  });
});

describe("the e-invoice reader has no way out of the process", () => {
  const dir = join(process.cwd(), "src/server/fatturapa");
  const sources = readdirSync(dir).filter((name) => name.endsWith(".ts"));

  it("lists the source files it scans", () => {
    expect(sources).toContain("cms.ts");
  });

  it.each(sources)("%s imports no child process, file system, network or worker", (name) => {
    const text = readFileSync(join(dir, name), "utf8");
    expect(text).not.toMatch(
      /child_process|\bspawn\(|\bexecSync\(|\bexecFile\(|node:fs|from "fs"|node:net|node:http|node:dns|worker_threads|\bfetch\(/,
    );
  });
});
