// Daily backup, part 3 (M25 step 13, plan §3.1.7): one GET of the project's Auth health endpoint with the publishable key.
// A failure also tells us the project is paused (Supabase Free).
//   npx tsx scripts/backup/keepalive.ts
// Environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Prints a code on failure, never the key or the host.
import { pathToFileURL } from "node:url";
import { pingAuthHealth } from "../lib/backup/keepalive";

export type KeepaliveDeps = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  log: (line: string) => void;
};

export async function runKeepalive(deps: KeepaliveDeps): Promise<number> {
  const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key } = deps.env;
  const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_PUBLISHABLE_KEY"].filter(Boolean);
  if (!url || !key) {
    deps.log(`backup_env_missing:${missing.join(",")}`);
    return 1;
  }
  try {
    await pingAuthHealth(deps.fetch, url, key);
    deps.log("keepalive_ok");
    return 0;
  } catch (error) {
    deps.log((error as Error).message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKeepalive({ env: process.env, fetch, log: (line) => console.log(line) }).then((code) => {
    process.exitCode = code;
  });
}
