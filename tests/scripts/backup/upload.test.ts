import { generateKeyPairSync } from "node:crypto";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { runUpload, type UploadDeps } from "../../../scripts/backup/upload";

const FOLDER = "folder-id-fake-123";
const BYTES = new TextEncoder().encode("encrypted-bytes");
const NAME = "osteria-backup-20261105T021509Z-production.tar.gpg";
let sa = "";
beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  sa = JSON.stringify({
    client_email: "backup@fake.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
});

function setup(env: Record<string, string | undefined> = {}, existing = 0) {
  const calls: { url: string; method: string }[] = [];
  const lines: string[] = [];
  const old = Array.from({ length: existing }, (_, i) => ({
    id: `old${i}`,
    name: `osteria-backup-202610${String(i + 1).padStart(2, "0")}T021509Z-production.tar.gpg`,
    createdTime: `2026-10-${String(i + 1).padStart(2, "0")}T02:15:09.000Z`,
    md5Checksum: "m",
  }));
  const deps: UploadDeps = {
    env: { BACKUP_DRIVE_SA_JSON: sa, BACKUP_DRIVE_FOLDER_ID: FOLDER, ...env },
    fetch: (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      const method = init?.method ?? "GET";
      calls.push({ url: u.origin + u.pathname, method });
      if (u.hostname === "oauth2.googleapis.com") {
        return new Response(JSON.stringify({ access_token: "ya29.fake" }));
      }
      if (method === "POST") {
        return new Response(null, {
          headers: { Location: "https://www.googleapis.com/upload/x?id=1" },
        });
      }
      if (method === "PUT") {
        const md5 = createHash("md5").update(BYTES).digest("hex");
        // Like Drive, the folder lists the new file from now on.
        old.push({
          id: "new1",
          name: NAME,
          createdTime: "2026-11-05T02:20:00.000Z",
          md5Checksum: md5,
        });
        return new Response(JSON.stringify({ id: "new1", md5Checksum: md5 }));
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ files: old }));
    }) as typeof fetch,
    readFile: () => BYTES,
    now: () => new Date("2026-11-05T02:20:00Z"),
    log: (line) => void lines.push(line),
  };
  return { deps, calls, lines };
}
const ARGV = ["--file", `/run/backup/${NAME}`, "--target", "production", "--keep", "14"];

describe("runUpload", () => {
  it("gets a token, uploads, applies retention and prints names and numbers only", async () => {
    const { deps, calls, lines } = setup({}, 15);
    expect(await runUpload(ARGV, deps)).toBe(0);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
    const out = JSON.parse(lines.at(-1)!);
    expect(out).toEqual({ uploaded: NAME, bytes: BYTES.length, deleted: 2 });
    const text = lines.join("\n");
    for (const secret of [FOLDER, "ya29", "BEGIN PRIVATE KEY"]) expect(text).not.toContain(secret);
  });

  it("fails without the service account or folder, before any request", async () => {
    for (const env of [{ BACKUP_DRIVE_SA_JSON: undefined }, { BACKUP_DRIVE_FOLDER_ID: "" }]) {
      const { deps, calls } = setup(env);
      expect(await runUpload(ARGV, deps)).toBe(1);
      expect(calls).toEqual([]);
    }
  });

  it("fails on a service account that is not JSON, without echoing it", async () => {
    const { deps, calls, lines } = setup({ BACKUP_DRIVE_SA_JSON: "{oops-secret" });
    expect(await runUpload(ARGV, deps)).toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).not.toContain("oops-secret");
  });

  it("refuses a file that is not a backup of the target, and a bad --keep", async () => {
    const a = setup();
    expect(
      await runUpload(["--file", "/x/other.txt", "--target", "production", "--keep", "14"], a.deps),
    ).toBe(1);
    const b = setup();
    expect(
      await runUpload(["--file", `/x/${NAME}`, "--target", "staging", "--keep", "14"], b.deps),
    ).toBe(1);
    const c = setup();
    expect(
      await runUpload(["--file", `/x/${NAME}`, "--target", "production", "--keep", "0"], c.deps),
    ).toBe(1);
    for (const s of [a, b, c]) expect(s.calls).toEqual([]);
  });

  it("reports a Drive failure as a code", async () => {
    const { deps, lines } = setup();
    deps.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    expect(await runUpload(ARGV, deps)).toBe(1);
    expect(lines.join("\n")).toContain("drive_token_failed:403");
  });
});
