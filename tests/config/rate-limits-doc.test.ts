import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25 step 6: docs/go-live/rate-limits.md has one row per sensitive route (every route file under src/app/api/{auth,devices,cron,public}
// and four named ones) and one for the service worker's warm reads. A new route there without a row fails this test.
const ROOT = new URL("../../", import.meta.url).pathname;
const API = join(ROOT, "src/app/api");
const DOC = readFileSync(join(ROOT, "docs/go-live/rate-limits.md"), "utf8");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}
const toUrl = (file: string) => `/api/${file.slice(API.length + 1).replace(/\/?route\.ts$/, "")}`;

const EXTRA = ["me/password", "invoices", "invoices/[id]/retry", "sync"];
const routes = [
  ...["auth", "devices", "cron", "public"].flatMap((d) => routeFiles(join(API, d))),
  ...EXTRA.map((r) => join(API, r, "route.ts")),
].map(toUrl);

type Row = { route: string; limit: string; verdict: string; reason: string; tests: string[] };
const rows: Row[] = DOC.split("\n")
  .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim()),
  )
  .filter((cells) => cells.length === 6 && cells[0] !== "Route")
  .map(([route, , limit, verdict, reason, tests]) => ({
    route: route!.replace(/`/g, ""),
    limit: limit!,
    verdict: verdict!,
    reason: reason!,
    tests: [...tests!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
  }));

describe("the route list", () => {
  it("includes the routes added by M25a and the four named ones", () => {
    for (const path of [
      "/api/auth/password",
      "/api/auth/email-code",
      "/api/auth/magic-link",
      "/api/auth/pin",
      "/api/auth/device",
      "/api/auth/callback",
      "/api/auth/logout",
      "/api/devices",
      "/api/devices/[id]",
      "/api/devices/[id]/unlock",
      "/api/devices/enrol",
      "/api/devices/enrolment-codes",
      "/api/cron/extract",
      "/api/me/password",
      "/api/invoices",
      "/api/invoices/[id]/retry",
      "/api/sync",
      "/api/public/reservations/[slug]/page",
      "/api/public/reservations/[slug]/slots",
      "/api/public/reservations/[slug]/requests",
      "/api/public/reservations/[slug]/cancel",
    ]) {
      expect(routes).toContain(path);
    }
  });
});

// The public booking routes (reservations N9): the numbers in the requests row are the ones the database enforces, so a change in
// app.reservation_limits() or in the form-token ages fails here until the doc says the same.
describe("the public reservation rows", () => {
  const row = (name: string) =>
    rows.find((r) => r.route === `/api/public/reservations/[slug]/${name}`)!;
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20261124100300_reservation_request_core.sql"),
    "utf8",
  );
  const limits = JSON.parse(/select '(\{"ip"[^']+\})'::jsonb/.exec(sql)![1]!) as Record<
    "ip" | "email" | "phone" | "pendingPerTenant",
    number
  >;

  it("states the per-day limits of app.reservation_limits() in the requests row", () => {
    const text = row("requests").limit;
    expect(text).toContain(`${limits.ip} per IP hash`);
    expect(text).toContain(`${limits.email} per e-mail`);
    expect(text).toContain(`${limits.phone} per phone`);
    expect(text).toContain(`${limits.pendingPerTenant} pending per tenant`);
  });

  it("lists every guard of the requests route, with the form-token window", () => {
    const text = row("requests").limit;
    for (const guard of ["gate", "Origin", "4 KB", "honeypot", "3 s to 2 h"]) {
      expect(text, guard).toContain(guard);
    }
  });

  it("says page and slots are unthrottled GETs behind the gate, and cancel is an HMAC token", () => {
    for (const name of ["page", "slots"]) {
      expect(row(name).limit, name).toMatch(/unthrottled/i);
      expect(row(name).limit, name).toContain("gate");
    }
    expect(row("cancel").limit).toContain("HMAC token");
  });
});

describe("docs/go-live/rate-limits.md", () => {
  it.each(routes)("has exactly one row for %s", (route) => {
    expect(rows.filter((r) => r.route === route)).toHaveLength(1);
  });

  it("has a warm-reads row", () => {
    expect(rows.filter((r) => r.route === "warm-reads")).toHaveLength(1);
  });

  it("has no row for a route that does not exist", () => {
    const known = new Set([...routes, "warm-reads"]);
    expect(rows.filter((r) => !known.has(r.route)).map((r) => r.route)).toEqual([]);
  });

  it("gives every row a verdict of ok or accepted", () => {
    for (const row of rows) expect(["ok", "accepted"], row.route).toContain(row.verdict);
  });

  it("gives every row a reason (an accepted one must have it)", () => {
    for (const row of rows) expect(row.reason.length, row.route).toBeGreaterThan(10);
  });

  it("names an existing file in every test cell", () => {
    for (const row of rows) {
      expect(row.tests.length, row.route).toBeGreaterThan(0);
      for (const file of row.tests)
        expect(existsSync(join(ROOT, file)), `${row.route}: ${file}`).toBe(true);
    }
  });
});
