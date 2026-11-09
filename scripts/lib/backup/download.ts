// The invoice-file downloader (ADR-034). The only code that holds the Supabase secret key inside the files step.
// It matches what storage-js `download()` sends: GET `${url}/storage/v1/object/<bucket>/<path>` with the headers `apikey: <key>`
// and `Authorization: Bearer <key>`. storage-js does not encode the path; here every segment goes through encodeURIComponent, so a
// key holding `?`, `#`, `%` or an encoded dot cannot change the request. A path that could leave the bucket is refused first.
// No error carries a URL, a header, a key or a path.
export const INVOICE_BUCKET = "invoices";

/** False for an empty segment, a `.` or `..` segment, or a leading `/`. `?`, `#` and `%` are legal key characters. */
export function isSafeObjectPath(path: string): boolean {
  return path.length > 0 && path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export type DownloadOptions = { fetch: typeof fetch; url: string; key: string };

export function makeDownloadObject({ fetch: fetchFn, url, key }: DownloadOptions) {
  const base = `${url.replace(/\/+$/, "")}/storage/v1/object/${INVOICE_BUCKET}/`;
  return async (path: string): Promise<Uint8Array> => {
    if (!isSafeObjectPath(path)) throw new Error("download_failed:invalid_path");
    const target = base + path.split("/").map(encodeURIComponent).join("/");
    let response: Response;
    try {
      response = await fetchFn(target, {
        method: "GET",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
    } catch {
      throw new Error("download_failed:network");
    }
    if (!response.ok) throw new Error(`download_failed:${response.status}`);
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new Error("download_failed:network");
    }
  };
}
