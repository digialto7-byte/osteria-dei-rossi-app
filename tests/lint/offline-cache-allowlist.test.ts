import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFLINE_CACHE_PATHS,
  OFFLINE_CACHE_ROLES,
  offlineCacheable,
} from "@/lib/api/offline-cache";
import { canSync } from "@/pwa/sync-runner";

// M20 plan §3.5, ADR-022: only the four waiter reads may mark a response cacheable by the service worker (`x-offline-cache: 1`),
// and their paths are the worker's allowlist. A fifth importer (say, a route with costs) fails here before it can ship.
const ROOT = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const importers = files(ROOT).filter((file) => {
  if (file.endsWith(`${sep}lib${sep}api${sep}offline-cache.ts`)) return false;
  return /offline-cache["']/.test(readFileSync(file, "utf8"));
});

/** src/app/api/table-sessions/[id]/lines/route.ts -> /api/table-sessions/:id/lines */
const pathOf = (file: string) =>
  "/" +
  relative(join(ROOT, "app"), file)
    .split(sep)
    .slice(0, -1)
    .join("/")
    .replace(/\[(\w+)\]/g, ":$1");

describe("offline-cache importers", () => {
  it("are exactly the four cost-free waiter reads", () => {
    expect(importers.map(pathOf).sort()).toEqual([...OFFLINE_CACHE_PATHS].sort());
    expect(importers.every((file) => file.endsWith("route.ts"))).toBe(true);
  });

  it("the paths are the four of the plan, and none is a cost route", () => {
    expect([...OFFLINE_CACHE_PATHS]).toEqual([
      "/api/me",
      "/api/menu",
      "/api/tables",
      "/api/table-sessions/:id/lines",
    ]);
    expect(
      OFFLINE_CACHE_PATHS.filter((p) => /cost|margin|report|dashboard|invoice|payable/.test(p)),
    ).toEqual([]);
  });

  it("offlineCacheable marks a response and keeps its body and status", async () => {
    const response = offlineCacheable(Response.json({ a: 1 }, { status: 200 }), "waiter");
    expect(response.headers.get("x-offline-cache")).toBe("1");
    expect(await response.json()).toEqual({ a: 1 });
  });

  it("the covered roles are owner, admin and waiter, never the chef (plan §3.5, ADR-022)", () => {
    expect([...OFFLINE_CACHE_ROLES].sort()).toEqual(["admin", "owner", "waiter"]);
  });

  it.each(["owner", "admin", "waiter"])("offlineCacheable marks a %s's response", (role) => {
    expect(offlineCacheable(Response.json({}), role).headers.get("x-offline-cache")).toBe("1");
  });

  it.each(["chef", "", "root", undefined])(
    "offlineCacheable leaves a response alone for role %j, keeping body and status",
    async (role) => {
      const response = offlineCacheable(Response.json({ a: 1 }, { status: 200 }), role);
      expect(response.headers.has("x-offline-cache")).toBe(false);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ a: 1 });
    },
  );

  it("the warm-up's role check (canSync) accepts exactly the covered roles", () => {
    for (const role of ["owner", "admin", "waiter", "chef", "x", undefined]) {
      expect(canSync(role)).toBe(
        (OFFLINE_CACHE_ROLES as readonly (string | undefined)[]).includes(role),
      );
    }
  });
});
