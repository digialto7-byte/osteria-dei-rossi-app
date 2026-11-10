import { createHash, createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyRetention,
  download,
  fetchAccessToken,
  listFiles,
  newestBackup,
  serviceAccountJwt,
  uploadResumable,
} from "../../../scripts/lib/backup/drive";

// Test keys are made here, in memory, for every run: no key is stored in the repository.
const FOLDER = "folder-id-fake-123";
const TOKEN = "ya29.fake-access-token";
let privateKey = "";
let publicKey = "";
beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
});

const b64 = (text: string) => JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest("hex");

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
/** A fake fetch: `handler` answers by method and URL; every call is recorded. */
function fake(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetchFn, calls };
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });

describe("serviceAccountJwt", () => {
  it("is RS256 with the right claims and a signature that verifies", () => {
    const jwt = serviceAccountJwt(
      { client_email: "backup@fake-project.iam.gserviceaccount.com", private_key: privateKey },
      1_800_000_000,
    );
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    expect(b64(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(b64(claims)).toEqual({
      iss: "backup@fake-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const verify = createVerify("RSA-SHA256").update(`${header}.${claims}`);
    expect(verify.verify(createPublicKey(publicKey), Buffer.from(signature, "base64url"))).toBe(
      true,
    );
  });

  it("rejects a service account without an email or a key, without echoing the key", () => {
    expect(() => serviceAccountJwt({ client_email: "", private_key: privateKey }, 1)).toThrow(
      "drive_service_account_invalid",
    );
    expect(() => serviceAccountJwt({ client_email: "a@b.c", private_key: "not a key" }, 1)).toThrow(
      "drive_service_account_invalid",
    );
  });
});

describe("fetchAccessToken", () => {
  const sa = { client_email: "backup@fake.iam.gserviceaccount.com", private_key: "" };

  it("makes one POST with the JWT-bearer grant and returns the token", async () => {
    const { fetchFn, calls } = fake(() => json({ access_token: TOKEN }));
    const token = await fetchAccessToken(
      fetchFn,
      { ...sa, private_key: privateKey },
      1_800_000_000,
    );
    expect(token).toBe(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.method).toBe("POST");
    const form = new URLSearchParams(String(calls[0]!.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);
  });

  it("throws a status code, not the response, when Google refuses", async () => {
    const { fetchFn } = fake(() => json({ error: "invalid_grant", detail: privateKey }, 400));
    const error = await fetchAccessToken(fetchFn, { ...sa, private_key: privateKey }, 1).catch(
      (e) => e,
    );
    expect((error as Error).message).toBe("drive_token_failed:400");
  });
});

describe("uploadResumable", () => {
  const bytes = new TextEncoder().encode("encrypted-bytes");
  const LOCATION = "https://www.googleapis.com/upload/drive/v3/files?upload_id=fake-session";

  function uploader(returned: { id: string; md5Checksum: string }) {
    return fake((call) =>
      call.method === "POST"
        ? new Response(null, { status: 200, headers: { Location: LOCATION } })
        : call.method === "PUT"
          ? json(returned)
          : new Response(null, { status: 204 }),
    );
  }

  it("starts a resumable session in the folder, then PUTs the bytes to the Location", async () => {
    const { fetchFn, calls } = uploader({ id: "file-1", md5Checksum: md5(bytes) });
    const result = await uploadResumable(fetchFn, TOKEN, FOLDER, "osteria-backup-x.tar.gpg", bytes);
    expect(result).toEqual({ id: "file-1", md5Checksum: md5(bytes) });
    const [start, put] = calls as [Call, Call];
    expect(start.method).toBe("POST");
    expect(start.url).toContain(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    );
    expect(start.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(start.body))).toEqual({
      name: "osteria-backup-x.tar.gpg",
      parents: [FOLDER],
    });
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(LOCATION);
    expect(put.body).toBe(bytes);
  });

  it("deletes the file and throws upload_checksum_mismatch when the MD5 differs", async () => {
    const { fetchFn, calls } = uploader({ id: "file-2", md5Checksum: "0".repeat(32) });
    await expect(
      uploadResumable(fetchFn, TOKEN, FOLDER, "osteria-backup-x.tar.gpg", bytes),
    ).rejects.toThrow("upload_checksum_mismatch");
    const last = calls.at(-1)!;
    expect(last.method).toBe("DELETE");
    expect(last.url).toContain("/drive/v3/files/file-2");
  });

  it("throws a status when the session cannot start or the PUT fails, with no secret in the message", async () => {
    const refuse = fake(() => json({}, 403));
    const a = await uploadResumable(refuse.fetchFn, TOKEN, FOLDER, "n", bytes).catch((e) => e);
    expect((a as Error).message).toBe("drive_upload_failed:403");
    const noLocation = fake(() => new Response(null, { status: 200 }));
    const b = await uploadResumable(noLocation.fetchFn, TOKEN, FOLDER, "n", bytes).catch((e) => e);
    expect((b as Error).message).toBe("drive_upload_failed:no_location");
    const failPut = fake((call) =>
      call.method === "POST"
        ? new Response(null, { headers: { Location: LOCATION } })
        : json({}, 500),
    );
    const c = await uploadResumable(failPut.fetchFn, TOKEN, FOLDER, "n", bytes).catch((e) => e);
    expect((c as Error).message).toBe("drive_upload_failed:500");
    for (const e of [a, b, c]) {
      for (const secret of [TOKEN, FOLDER]) expect((e as Error).message).not.toContain(secret);
    }
  });

  it("refuses a folder id that is not a plain id", async () => {
    const { fetchFn, calls } = uploader({ id: "x", md5Checksum: md5(bytes) });
    await expect(uploadResumable(fetchFn, TOKEN, "a' or 'b", "n", bytes)).rejects.toThrow(
      "drive_folder_invalid",
    );
    expect(calls).toHaveLength(0);
  });
});

/** A fake Drive folder listing: files with a creation time. */
function folder(files: { id: string; name: string; createdTime: string }[], pageSize = 100) {
  return fake((call) => {
    const url = new URL(call.url);
    if (call.method === "GET" && url.pathname === "/drive/v3/files") {
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = files.slice(start, start + pageSize);
      const next = start + pageSize < files.length ? String(start + pageSize) : undefined;
      return json({
        files: page.map((f) => ({ ...f, md5Checksum: `md5-${f.id}` })),
        nextPageToken: next,
      });
    }
    if (call.method === "GET" && url.searchParams.get("alt") === "media") {
      return new Response(new Uint8Array([1, 2, 3]));
    }
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    return json({}, 404);
  });
}
const stamp = (day: number) => `2026-11-${String(day).padStart(2, "0")}T02:15:09.000Z`;
const prodName = (day: number) =>
  `osteria-backup-202611${String(day).padStart(2, "0")}T021509Z-production.tar.gpg`;
const stagingName = (day: number) => prodName(day).replace("production", "staging");

describe("newestBackup", () => {
  const files = [
    { id: "p1", name: prodName(3), createdTime: stamp(3) },
    { id: "p2", name: prodName(5), createdTime: stamp(5) },
    { id: "p3", name: prodName(4), createdTime: stamp(4) },
    { id: "s1", name: stagingName(9), createdTime: stamp(9) },
    { id: "o1", name: "other.txt", createdTime: stamp(10) },
  ];

  it("returns the latest production file among three dates, staging files and an unrelated file", async () => {
    const { fetchFn, calls } = folder(files);
    const newest = await newestBackup(fetchFn, TOKEN, FOLDER, "production");
    expect(newest).toEqual({
      id: "p2",
      name: prodName(5),
      createdTime: stamp(5),
      md5Checksum: "md5-p2",
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("q")).toContain(`'${FOLDER}' in parents`);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("returns the staging file for the staging target", async () => {
    const { fetchFn } = folder(files);
    expect((await newestBackup(fetchFn, TOKEN, FOLDER, "staging"))?.id).toBe("s1");
  });

  it("returns null when there is none", async () => {
    const { fetchFn } = folder([{ id: "o1", name: "other.txt", createdTime: stamp(10) }]);
    expect(await newestBackup(fetchFn, TOKEN, FOLDER, "production")).toBeNull();
  });

  it("follows the next page", async () => {
    const { fetchFn, calls } = folder(files, 2);
    expect((await newestBackup(fetchFn, TOKEN, FOLDER, "production"))?.id).toBe("p2");
    expect(calls.length).toBeGreaterThan(1);
  });

  it("throws a status when the listing fails", async () => {
    const { fetchFn } = fake(() => json({}, 500));
    await expect(newestBackup(fetchFn, TOKEN, FOLDER, "production")).rejects.toThrow(
      "drive_list_failed:500",
    );
  });
});

describe("download", () => {
  it("returns the bytes", async () => {
    const { fetchFn, calls } = folder([]);
    expect(await download(fetchFn, TOKEN, "file-1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]!.url).toContain("/drive/v3/files/file-1?");
    expect(calls[0]!.url).toContain("alt=media");
    expect(calls[0]!.url).toContain("supportsAllDrives=true");
  });

  it("throws a status on failure", async () => {
    const { fetchFn } = fake(() => new Response("no", { status: 404 }));
    await expect(download(fetchFn, TOKEN, "gone")).rejects.toThrow("drive_download_failed:404");
  });
});

describe("applyRetention", () => {
  // 16 production + 2 staging + other.txt; days 1..16 for production.
  const files = [
    ...Array.from({ length: 16 }, (_, i) => ({
      id: `p${i + 1}`,
      name: prodName(i + 1),
      createdTime: stamp(i + 1),
    })),
    { id: "s1", name: stagingName(1), createdTime: stamp(1) },
    { id: "s2", name: stagingName(2), createdTime: stamp(2) },
    { id: "o1", name: "other.txt", createdTime: stamp(1) },
  ];

  it("keeping 14 deletes exactly the 2 oldest production files", async () => {
    const { fetchFn, calls } = folder(files);
    const result = await applyRetention(fetchFn, TOKEN, FOLDER, "production", 14);
    expect(result.deleted).toEqual([prodName(2), prodName(1)]);
    const deleted = calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).pathname);
    expect(deleted).toEqual(["/drive/v3/files/p2", "/drive/v3/files/p1"]);
    expect(
      calls
        .filter((c) => c.method === "DELETE")
        .every((c) => c.url.includes("supportsAllDrives=true")),
    ).toBe(true);
  });

  it("keeping 16 deletes nothing", async () => {
    const { fetchFn, calls } = folder(files);
    expect((await applyRetention(fetchFn, TOKEN, FOLDER, "production", 16)).deleted).toEqual([]);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("never deletes staging files or other files when applied to production", async () => {
    const { fetchFn, calls } = folder(files);
    await applyRetention(fetchFn, TOKEN, FOLDER, "production", 1);
    const ids = calls
      .filter((c) => c.method === "DELETE")
      .map((c) => new URL(c.url).pathname.split("/").pop());
    expect(ids).toHaveLength(15);
    expect(ids.some((id) => id!.startsWith("s") || id === "o1")).toBe(false);
    expect(ids).not.toContain("p16");
  });

  it("refuses a keep below 1 or not an integer, before any request", async () => {
    for (const keep of [0, -1, 1.5, Number.NaN]) {
      const { fetchFn, calls } = folder(files);
      await expect(applyRetention(fetchFn, TOKEN, FOLDER, "production", keep)).rejects.toThrow(
        "retention_keep_invalid",
      );
      expect(calls).toHaveLength(0);
    }
  });

  it("deletes nothing when the listing fails", async () => {
    const { fetchFn, calls } = fake(() => json({}, 500));
    await expect(applyRetention(fetchFn, TOKEN, FOLDER, "production", 14)).rejects.toThrow(
      "drive_list_failed:500",
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("throws a status when a delete fails", async () => {
    const { fetchFn } = fake((call) =>
      call.method === "DELETE"
        ? new Response(null, { status: 403 })
        : json({ files: files.map((f) => ({ ...f, md5Checksum: "m" })) }),
    );
    await expect(applyRetention(fetchFn, TOKEN, FOLDER, "production", 14)).rejects.toThrow(
      "drive_delete_failed:403",
    );
  });
});

// Invoice-file backup (ADR-034): packs are never deleted by code; manifests rotate like database copies.
const packName = (day: number, target = "production", nn = "01") =>
  `osteria-files-202611${String(day).padStart(2, "0")}T021509Z-${target}-${nn}.tar.gpg`;
const manifestName = (day: number, target = "production") =>
  `osteria-files-manifest-202611${String(day).padStart(2, "0")}T021509Z-${target}.json.gpg`;
const deletedIds = (calls: Call[]) =>
  calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).pathname.split("/").pop());

describe("listFiles", () => {
  const files = [
    { id: "m1", name: manifestName(1), createdTime: stamp(1) },
    { id: "m2", name: manifestName(2), createdTime: stamp(2) },
    { id: "k1", name: packName(1), createdTime: stamp(1) },
    { id: "d1", name: prodName(1), createdTime: stamp(1) },
  ];
  const isManifest = (name: string) => /^osteria-files-manifest-/.test(name);

  it("lists what the predicate accepts, newest first, with the prefix in the query", async () => {
    const { fetchFn, calls } = folder(files);
    const found = await listFiles(fetchFn, TOKEN, FOLDER, "osteria-files-", isManifest);
    expect(found.map((f) => f.id)).toEqual(["m2", "m1"]);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("q")).toBe(
      `'${FOLDER}' in parents and trashed = false and name contains 'osteria-files-'`,
    );
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("follows nextPageToken", async () => {
    const { fetchFn, calls } = folder(files, 1);
    const found = await listFiles(fetchFn, TOKEN, FOLDER, "osteria-files-", isManifest);
    expect(found.map((f) => f.id)).toEqual(["m2", "m1"]);
    expect(calls).toHaveLength(4);
  });

  it("refuses a prefix that could change the query, and a folder id that is not plain, before any request", async () => {
    const { fetchFn, calls } = folder(files);
    await expect(
      listFiles(fetchFn, TOKEN, FOLDER, "x' or name contains '", () => true),
    ).rejects.toThrow("drive_list_prefix_invalid");
    await expect(listFiles(fetchFn, TOKEN, "a b", "osteria-files-", () => true)).rejects.toThrow(
      "drive_folder_invalid",
    );
    expect(calls).toHaveLength(0);
  });

  it("throws a status when the listing fails", async () => {
    const { fetchFn } = fake(() => json({}, 500));
    await expect(listFiles(fetchFn, TOKEN, FOLDER, "osteria-files-", () => true)).rejects.toThrow(
      "drive_list_failed:500",
    );
  });
});

describe("applyRetention for invoice-file backups", () => {
  // 16 production manifests, 2 staging manifests, 3 packs (one staging), 2 database copies, other.txt.
  const files = [
    ...Array.from({ length: 16 }, (_, i) => ({
      id: `m${i + 1}`,
      name: manifestName(i + 1),
      createdTime: stamp(i + 1),
    })),
    { id: "sm1", name: manifestName(1, "staging"), createdTime: stamp(1) },
    { id: "sm2", name: manifestName(2, "staging"), createdTime: stamp(2) },
    { id: "k1", name: packName(1), createdTime: stamp(1) },
    { id: "k2", name: packName(2, "production", "02"), createdTime: stamp(2) },
    { id: "sk1", name: packName(1, "staging"), createdTime: stamp(1) },
    { id: "d1", name: prodName(1), createdTime: stamp(1) },
    { id: "d2", name: prodName(2), createdTime: stamp(2) },
    { id: "o1", name: "other.txt", createdTime: stamp(1) },
  ];

  it("files-manifest retention deletes only the target's manifests beyond keep, oldest first", async () => {
    const { fetchFn, calls } = folder(files);
    const result = await applyRetention(fetchFn, TOKEN, FOLDER, "production", 14, "files-manifest");
    expect(result.deleted).toEqual([manifestName(2), manifestName(1)]);
    expect(deletedIds(calls)).toEqual(["m2", "m1"]);
  });

  it("files-manifest retention with keep 1 never touches a pack, a database copy, staging or another file", async () => {
    const { fetchFn, calls } = folder(files);
    await applyRetention(fetchFn, TOKEN, FOLDER, "production", 1, "files-manifest");
    const ids = deletedIds(calls);
    expect(ids).toHaveLength(15);
    expect(ids.every((id) => /^m\d+$/.test(id!))).toBe(true);
    expect(ids).not.toContain("m16");
  });

  it("database retention never deletes an osteria-files name, however small keep is", async () => {
    const { fetchFn, calls } = folder(files);
    const result = await applyRetention(fetchFn, TOKEN, FOLDER, "production", 1);
    expect(result.deleted).toEqual([prodName(1)]);
    expect(deletedIds(calls)).toEqual(["d1"]);
  });

  it("the default kind is the database copies (callers that pass no kind are unchanged)", async () => {
    const { fetchFn } = folder(files);
    const a = await applyRetention(fetchFn, TOKEN, FOLDER, "production", 1);
    const b = await applyRetention(fetchFn, TOKEN, FOLDER, "production", 1, "db");
    expect(a).toEqual(b);
  });

  it("the database listing and newestBackup never see osteria-files names", async () => {
    const { fetchFn } = folder(files);
    expect((await newestBackup(fetchFn, TOKEN, FOLDER, "production"))?.id).toBe("d2");
  });

  it("refuses an invalid keep before any request", async () => {
    const { fetchFn, calls } = folder(files);
    await expect(
      applyRetention(fetchFn, TOKEN, FOLDER, "production", 0, "files-manifest"),
    ).rejects.toThrow("retention_keep_invalid");
    expect(calls).toHaveLength(0);
  });
});

describe("no secret in any message", () => {
  it("errors never hold the token or the folder id", async () => {
    const { fetchFn } = fake(() => json({ error: `${TOKEN} ${FOLDER}` }, 500));
    for (const run of [
      () => newestBackup(fetchFn, TOKEN, FOLDER, "production"),
      () => download(fetchFn, TOKEN, "f"),
      () => applyRetention(fetchFn, TOKEN, FOLDER, "production", 14),
    ]) {
      const error = await run().catch((e) => e);
      expect((error as Error).message).not.toContain(TOKEN);
      expect((error as Error).message).not.toContain(FOLDER);
    }
  });
});
