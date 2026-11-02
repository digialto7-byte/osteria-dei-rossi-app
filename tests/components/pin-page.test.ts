import { beforeEach, describe, expect, it, vi } from "vitest";

const redirected = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("next/navigation", () => ({
  redirect: (path: string): never => {
    redirected.paths.push(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

import PinPage from "@/app/(public)/pin/page";

beforeEach(() => {
  redirected.paths.length = 0;
});

describe("/pin", () => {
  it("redirects to /login, so old bookmarks and home-screen starts still work", () => {
    expect(() => PinPage()).toThrow("NEXT_REDIRECT");
    expect(redirected.paths).toEqual(["/login"]);
  });
});
