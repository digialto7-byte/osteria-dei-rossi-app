import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The two reservation keys (RESERVATION_GATE_KEY, RESERVATION_LINK_KEY) must never reach the browser bundle: every module that holds or reads one starts with
// `import "server-only"`, so importing it from a client component is a build error (lead read of #69). The env reader (src/lib/env/index.ts) is shared with
// instrumentation and is not a server-only module, so it is not on the list; it only reads process.env.
const MODULES = [
  "src/server/reservations/public/gate.ts",
  "src/server/reservations/public/tokens.ts",
  "src/server/reservations/public/http.ts",
  "src/server/reservations/public/client.ts",
  "src/server/reservations/public/page.ts",
  "src/server/reservations/public/request.ts",
  "src/server/reservations/public/cancel.ts",
  "src/server/reservations/mail/render.ts",
  "src/server/cron/reservation-mail-job.ts",
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the modules that read a reservation key are server-only", () => {
  it.each(MODULES)("%s starts with the marker", (path) => {
    expect(readFileSync(path, "utf8")).toMatch(/^import "server-only";/m);
  });

  it("covers every module outside the routes and the env reader that names a key or builds the gate", () => {
    const found = sources("src")
      .filter((path) => !path.startsWith(join("src", "app", "api")))
      .filter((path) => path !== join("src", "lib", "env", "index.ts"))
      .filter((path) =>
        /RESERVATION_(GATE|LINK)_KEY|\b(gateKey|linkKey|gateMac|gateArgs|signFormToken|signCancelToken)\b/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .filter((path) => !/^import "server-only";/m.test(readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });
});
