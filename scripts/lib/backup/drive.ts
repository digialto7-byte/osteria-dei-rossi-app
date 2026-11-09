// Google Drive client for the backups (M25 step 12, plan §3.1.5, Q181): a service account that is a member of a Shared Drive,
// spoken to with `fetch` against the Drive REST API. No library is added (tests/config/no-new-deps.test.ts).
// Error messages are codes with a status at most: never the key, the token, the folder id or a response body.
import { createHash, createSign } from "node:crypto";
import { isBackupFileName, isFilesManifestName, type BackupTarget } from "./commands";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

export type ServiceAccount = { client_email: string; private_key: string };
export type DriveFile = { id: string; name: string; createdTime: string; md5Checksum: string };

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The signed JWT of the service account (RS256, one hour), to be exchanged for an access token. */
export function serviceAccountJwt(sa: ServiceAccount, nowSec: number): string {
  if (!sa.client_email) throw new Error("drive_service_account_invalid");
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  try {
    const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
    return `${unsigned}.${b64url(signature)}`;
  } catch {
    throw new Error("drive_service_account_invalid");
  }
}

/** One POST to Google's token endpoint with the JWT-bearer grant. */
export async function fetchAccessToken(
  fetchFn: typeof fetch,
  sa: ServiceAccount,
  nowSec: number,
): Promise<string> {
  const assertion = serviceAccountJwt(sa, nowSec);
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!response.ok) throw new Error(`drive_token_failed:${response.status}`);
  const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  if (typeof body?.access_token !== "string" || body.access_token === "") {
    throw new Error("drive_token_failed:no_token");
  }
  return body.access_token;
}

function assertFolder(folderId: string): void {
  if (!PLAIN_ID.test(folderId)) throw new Error("drive_folder_invalid");
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Uploads the bytes into the folder (one resumable session, one PUT) and verifies Drive's MD5 against our own. */
export async function uploadResumable(
  fetchFn: typeof fetch,
  token: string,
  folderId: string,
  name: string,
  bytes: Uint8Array,
): Promise<{ id: string; md5Checksum: string }> {
  assertFolder(folderId);
  const start = await fetchFn(
    `${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,md5Checksum`,
    {
      method: "POST",
      headers: {
        ...auth(token),
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": "application/octet-stream",
        "x-upload-content-length": String(bytes.byteLength),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    },
  );
  if (!start.ok) throw new Error(`drive_upload_failed:${start.status}`);
  const location = start.headers.get("location");
  if (!location) throw new Error("drive_upload_failed:no_location");
  const put = await fetchFn(location, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
    },
    body: bytes as BodyInit,
  });
  if (!put.ok) throw new Error(`drive_upload_failed:${put.status}`);
  const file = (await put.json().catch(() => null)) as {
    id?: unknown;
    md5Checksum?: unknown;
  } | null;
  if (typeof file?.id !== "string" || typeof file.md5Checksum !== "string") {
    throw new Error("drive_upload_failed:no_file");
  }
  // MD5 is Drive's own checksum, used here to detect a damaged transfer, not for security.
  if (file.md5Checksum !== createHash("md5").update(bytes).digest("hex")) {
    // A damaged copy must not stay in the folder as if it were a backup.
    await fetchFn(`${API}/${encodeURIComponent(file.id)}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: auth(token),
    }).catch(() => undefined);
    throw new Error("upload_checksum_mismatch");
  }
  return { id: file.id, md5Checksum: file.md5Checksum };
}

const PLAIN_PREFIX = /^[a-z0-9-]+$/;

/**
 * Every file of the folder whose name contains `prefix` and that `accept` takes, newest first. The prefix goes into the query, so it
 * is limited to lower-case letters, digits and dashes. Other files are ignored.
 */
export async function listFiles(
  fetchFn: typeof fetch,
  token: string,
  folderId: string,
  prefix: string,
  accept: (name: string) => boolean,
): Promise<DriveFile[]> {
  assertFolder(folderId);
  if (!PLAIN_PREFIX.test(prefix)) throw new Error("drive_list_prefix_invalid");
  const found: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and name contains '${prefix}'`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
      pageSize: "100",
      fields: "nextPageToken,files(id,name,createdTime,md5Checksum)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetchFn(`${API}?${params}`, { method: "GET", headers: auth(token) });
    if (!response.ok) throw new Error(`drive_list_failed:${response.status}`);
    const body = (await response.json().catch(() => null)) as {
      files?: DriveFile[];
      nextPageToken?: string;
    } | null;
    for (const file of body?.files ?? []) {
      if (accept(file.name)) found.push(file);
    }
    pageToken = body?.nextPageToken;
  } while (pageToken);
  return found.sort(
    (a, b) => b.createdTime.localeCompare(a.createdTime) || b.name.localeCompare(a.name),
  );
}

/** Every backup file of this target in the folder, newest first. Other files are ignored. */
const listBackups = (
  fetchFn: typeof fetch,
  token: string,
  folderId: string,
  target: BackupTarget,
) =>
  listFiles(fetchFn, token, folderId, "osteria-backup-", (name) => isBackupFileName(name, target));

/** The latest backup of the target, or null. */
export async function newestBackup(
  fetchFn: typeof fetch,
  token: string,
  folderId: string,
  target: BackupTarget,
): Promise<DriveFile | null> {
  return (await listBackups(fetchFn, token, folderId, target))[0] ?? null;
}

export async function download(
  fetchFn: typeof fetch,
  token: string,
  fileId: string,
): Promise<Uint8Array> {
  const response = await fetchFn(
    `${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { method: "GET", headers: auth(token) },
  );
  if (!response.ok) throw new Error(`drive_download_failed:${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Keeps the newest `keep` files of the kind and target and deletes the rest. `db` = database copies (the default), `files-manifest`
 * = invoice-file manifests. Packs (`osteria-files-<stamp>-…`) are in neither kind: no code deletes them (ADR-034).
 */
export async function applyRetention(
  fetchFn: typeof fetch,
  token: string,
  folderId: string,
  target: BackupTarget,
  keep: number,
  kind: "db" | "files-manifest" = "db",
): Promise<{ deleted: string[] }> {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("retention_keep_invalid");
  const listed =
    kind === "db"
      ? await listBackups(fetchFn, token, folderId, target)
      : await listFiles(fetchFn, token, folderId, "osteria-files-manifest-", (name) =>
          isFilesManifestName(name, target),
        );
  const old = listed.slice(keep);
  const deleted: string[] = [];
  for (const file of old) {
    const response = await fetchFn(`${API}/${encodeURIComponent(file.id)}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: auth(token),
    });
    if (!response.ok) throw new Error(`drive_delete_failed:${response.status}`);
    deleted.push(file.name);
  }
  return { deleted };
}
