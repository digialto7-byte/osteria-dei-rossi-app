import { describe, expect, it, vi } from "vitest";
import { createRegistrar, postClearUserData } from "@/pwa/register";

// M20 plan step 17: the worker is registered only in production, with the app version in its URL, and the browser is asked once
// to keep the storage (T3). Everything the browser offers is injected.
function navigatorWith(
  options: {
    serviceWorker?: boolean;
    persist?: "yes" | "reject" | "absent";
    controller?: boolean;
  } = {},
) {
  const register = vi.fn(async () => ({}));
  const persist = vi.fn(async () => {
    if (options.persist === "reject") throw new Error("denied");
    return true;
  });
  const post = vi.fn();
  const nav = {
    ...(options.serviceWorker === false
      ? {}
      : {
          serviceWorker: {
            register,
            controller: options.controller === false ? null : { postMessage: post },
          },
        }),
    ...(options.persist === "absent" ? {} : { storage: { persist } }),
  };
  return { nav, register, persist, post };
}

describe("createRegistrar", () => {
  it("registers /sw.js?v=<version> with scope / in production", async () => {
    const { nav, register } = navigatorWith();
    const result = await createRegistrar({ env: "production", version: "3f9c2ab", nav })();
    expect(result).toBe("registered");
    expect(register).toHaveBeenCalledWith("/sw.js?v=3f9c2ab", { scope: "/" });
  });

  it("asks to keep the storage once, even if called twice", async () => {
    const { nav, persist, register } = navigatorWith();
    const run = createRegistrar({ env: "production", version: "v1", nav });
    await run();
    await run();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each(["development", "test"])(
    "does nothing in %s (a worker would cache the dev server)",
    async (env) => {
      const { nav, register, persist } = navigatorWith();
      expect(await createRegistrar({ env, version: "dev", nav })()).toBe("skipped");
      expect(register).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    },
  );

  it("does nothing when the browser has no service worker, and never asks for storage", async () => {
    const { nav, persist } = navigatorWith({ serviceWorker: false });
    expect(await createRegistrar({ env: "production", version: "v1", nav })()).toBe("skipped");
    expect(persist).not.toHaveBeenCalled();
  });

  it("works when storage.persist does not exist, and when it rejects", async () => {
    const absent = navigatorWith({ persist: "absent" });
    expect(await createRegistrar({ env: "production", version: "v1", nav: absent.nav })()).toBe(
      "registered",
    );
    const rejects = navigatorWith({ persist: "reject" });
    expect(await createRegistrar({ env: "production", version: "v1", nav: rejects.nav })()).toBe(
      "registered",
    );
  });

  it("a failed registration is reported as skipped, not thrown (the app works without the worker)", async () => {
    const { nav, register } = navigatorWith();
    register.mockRejectedValueOnce(new Error("blocked"));
    expect(await createRegistrar({ env: "production", version: "v1", nav })()).toBe("skipped");
  });

  it("puts only safe characters in the worker URL", async () => {
    const { nav, register } = navigatorWith();
    await createRegistrar({ env: "production", version: "a b&c", nav })();
    expect(register).toHaveBeenCalledWith("/sw.js?v=a%20b%26c", { scope: "/" });
  });
});

describe("postClearUserData", () => {
  it("posts clear-user-data to the controlling worker", () => {
    const { nav, post } = navigatorWith();
    expect(postClearUserData(nav)).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: "clear-user-data" });
  });

  it("returns false when no worker controls the page, or there is none", () => {
    expect(postClearUserData(navigatorWith({ controller: false }).nav)).toBe(false);
    expect(postClearUserData(navigatorWith({ serviceWorker: false }).nav)).toBe(false);
    expect(postClearUserData(undefined)).toBe(false);
  });
});
