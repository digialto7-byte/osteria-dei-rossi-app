// AT2 (M25 step 3): fetches /login (twice), /api/health and /sw.js of a deployment and checks the security headers
// of ADR-028 with src/lib/security/header-check.ts. Prints one JSON line of header names and findings, never a
// header value, a nonce or a secret. Exit 1 on a finding.
//   npx tsx scripts/check-headers.ts --base-url https://<host> --expect local|preview|production
// For a Vercel deployment behind protection, set VERCEL_AUTOMATION_BYPASS_SECRET (sent as x-vercel-protection-bypass).
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkHeaders, type Expect } from "../src/lib/security/header-check";

const EXPECTATIONS: readonly Expect[] = ["local", "preview", "production"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function runCheckHeaders(
  argv: string[],
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch,
  write: (text: string) => void,
  writeError: (text: string) => void,
): Promise<number> {
  let values: { "base-url"?: string; expect?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: { "base-url": { type: "string" }, expect: { type: "string" } },
    }));
  } catch {
    writeError("Usage: check-headers --base-url <url> --expect local|preview|production");
    return 1;
  }
  const expectation = EXPECTATIONS.find((e) => e === values.expect);
  if (!expectation) {
    writeError("--expect must be local, preview or production.");
    return 1;
  }
  let base: URL;
  try {
    base = new URL(values["base-url"] ?? "");
  } catch {
    writeError("--base-url must be a URL.");
    return 1;
  }
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && LOCAL_HOSTS.has(base.hostname))
  ) {
    writeError("--base-url must be https (http only for localhost).");
    return 1;
  }

  const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const headers: Record<string, string> = bypass ? { "x-vercel-protection-bypass": bypass } : {};
  const get = async (path: string): Promise<Headers> => {
    const response = await fetchFn(new URL(path, base).toString(), {
      method: "GET",
      redirect: "manual",
      headers,
    });
    return response.headers;
  };

  let replies: Parameters<typeof checkHeaders>[0];
  try {
    const loginA = await get("/login");
    const loginB = await get("/login");
    replies = {
      "/login": [loginA, loginB],
      "/api/health": await get("/api/health"),
      "/sw.js": await get("/sw.js"),
    };
  } catch {
    writeError("A request failed.");
    return 1;
  }

  const { findings, notes } = checkHeaders(replies, expectation);
  write(JSON.stringify({ expect: expectation, findings, notes }));
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCheckHeaders(
    process.argv.slice(2),
    process.env,
    fetch,
    (text) => process.stdout.write(`${text}\n`),
    (text) => console.error(text),
  );
}
