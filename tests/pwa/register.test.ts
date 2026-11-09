import { describe, expect, it, vi } from "vitest";
import { clearSettled, createRegistrar, postClearUserData } from "@/pwa/register";

// M20 plan step 17: the worker is registered only in production, with the app version in its URL, and the browser is asked once
// to keep the storage (T3). Everything the browser offers is injected.
function navigatorWith(
  options: {
    serviceWorker?: boolean;
    persist?: "yes" | "reject" | "absent";
    controller?: boolean;
    /** A registration with an active worker that does not control this page (yet). */
    active?: boolean;
  } = {},
) {
  const register = vi.fn(async () => ({}));
  const persist = vi.fn(async () => {
    if (options.persist === "reject") throw new Error("denied");
    return true;
  });
  const post = vi.fn();
  const activePost = vi.fn();
  const getRegistration = vi.fn(async () =>
    options.active ? { active: { postMessage: activePost } } : undefined,
  );
  const nav = {
    ...(options.serviceWorker === false
      ? {}
      : {
          serviceWorker: {
            register,
            getRegistration,
            controller: options.controller === false ? null : { postMessage: post },
          },
        }),
    ...(options.persist === "absent" ? {} : { storage: { persist } }),
  };
  return { nav, register, persist, post, activePost, getRegistration };
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

  it("with no controlling worker the page deletes the read cache itself", () => {
    const remove = vi.fn(async () => true);
    expect(postClearUserData(navigatorWith({ controller: false }).nav, { delete: remove })).toBe(
      false,
    );
    expect(remove).toHaveBeenCalledWith("api-user");
    const other = vi.fn(async () => true);
    postClearUserData(navigatorWith().nav, { delete: other });
    expect(other).not.toHaveBeenCalled();
  });

  it("with no controller but an active worker, the worker is told too, so a late read it started before cannot store the old person's data", async () => {
    const remove = vi.fn(async () => true);
    const { nav, activePost } = navigatorWith({ controller: false, active: true });
    expect(postClearUserData(nav, { delete: remove })).toBe(false);
    expect(remove).toHaveBeenCalledWith("api-user");
    await clearSettled();
    expect(activePost).toHaveBeenCalledWith({ type: "clear-user-data" });
  });

  it("with no controller and no registration only the page's delete happens, and a failing lookup is not an error", async () => {
    const { nav, activePost } = navigatorWith({ controller: false });
    postClearUserData(nav, { delete: async () => true });
    await clearSettled();
    expect(activePost).not.toHaveBeenCalled();
    const failing = navigatorWith({ controller: false, active: true });
    failing.getRegistration.mockRejectedValueOnce(new Error("gone"));
    postClearUserData(failing.nav, { delete: async () => true });
    await expect(clearSettled()).resolves.toBeUndefined();
    expect(failing.activePost).not.toHaveBeenCalled();
  });

  it("a controlling worker is told once, not twice", () => {
    const { nav, post, getRegistration } = navigatorWith({ active: true });
    postClearUserData(nav);
    expect(post).toHaveBeenCalledTimes(1);
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("returns false when no worker controls the page, or there is none", () => {
    expect(postClearUserData(navigatorWith({ controller: false }).nav)).toBe(false);
    expect(postClearUserData(navigatorWith({ serviceWorker: false }).nav)).toBe(false);
    expect(postClearUserData(undefined)).toBe(false);
  });
});

describe("clearSettled", () => {
  it("resolves only when the page's own delete (no controller) has finished", async () => {
    let finish!: () => void;
    const remove = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
    );
    postClearUserData(navigatorWith({ controller: false }).nav, { delete: remove });
    let done = false;
    void clearSettled().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await clearSettled();
    expect(done).toBe(true);
  });

  it("a delete that fails still settles", async () => {
    postClearUserData(navigatorWith({ controller: false }).nav, {
      delete: () => Promise.reject(new Error("blocked")),
    });
    await expect(clearSettled()).resolves.toBeUndefined();
  });
});
