import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { forgetUser } from "@/components/forget-user";

describe("forgetUser", () => {
  it("forgets the cached user and tells the worker to clear its read cache", () => {
    const order: string[] = [];
    const reset = vi.fn(() => order.push("reset"));
    const post = vi.fn(() => {
      order.push("post");
      return true;
    });
    forgetUser(reset, post);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["post", "reset"]);
  });

  it("also tells the queue that nobody is signed in", () => {
    const clearQueueUser = vi.fn();
    forgetUser(vi.fn(), () => false, clearQueueUser);
    expect(clearQueueUser).toHaveBeenCalledTimes(1);
  });

  it("clears the cache even when no worker is there (post returns false)", () => {
    const reset = vi.fn();
    forgetUser(reset, () => false);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

// Logout, PIN login and the demo purge all end one person's use of the phone: each must go through forgetUser, so the worker's
// read cache (sale prices, staff names) never outlives the person (M20 plan §3.6.3, step 17).
describe("the three places that end a person's use of the phone", () => {
  const FILES = [
    "src/components/logout-button.tsx",
    "src/app/(public)/pin/pin-flow.tsx",
    "src/app/(owner)/impostazioni/dati-di-prova/purge-form.tsx",
  ];
  it.each(FILES)("%s calls forgetUser and not resetMe directly", (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    expect(source).toMatch(/forgetUser\(\)/);
    expect(source).not.toMatch(/\bresetMe\(\)/);
  });
});
