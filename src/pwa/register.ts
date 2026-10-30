// Registering the service worker (M20 plan §3.6.3). Production builds only: in development a worker would cache the dev server. The
// version is in the script URL, so every deploy installs a new worker and the old caches are cleaned (public/sw.js). Everything the
// browser offers is injected, so the rules can be tested.

interface NavLike {
  serviceWorker?: {
    register(url: string, options: { scope: string }): Promise<unknown>;
    controller?: { postMessage(message: unknown): void } | null;
  };
  storage?: { persist?: () => Promise<boolean> };
}

export function createRegistrar(deps: {
  env: string | undefined;
  version: string;
  nav: NavLike | undefined;
}): () => Promise<"registered" | "skipped"> {
  let done = false;
  return async () => {
    const sw = deps.nav?.serviceWorker;
    if (done || deps.env !== "production" || !sw) return "skipped";
    try {
      await sw.register(`/sw.js?v=${encodeURIComponent(deps.version)}`, { scope: "/" });
    } catch {
      return "skipped"; // the app works without the worker, just not offline
    }
    done = true;
    // Ask the browser not to evict the outbox and the caches (WebKit, T3). Once; a refusal is not an error.
    try {
      await deps.nav?.storage?.persist?.();
    } catch {
      // no persistent storage: the badge still shows what is waiting
    }
    return "registered";
  };
}

let registrar: ReturnType<typeof createRegistrar> | null = null;

/** Called once from the app shell, after the signed-in user is known. */
export function registerServiceWorker(): Promise<"registered" | "skipped"> {
  registrar ??= createRegistrar({
    env: process.env.NODE_ENV,
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
    nav: typeof navigator === "undefined" ? undefined : (navigator as NavLike),
  });
  return registrar();
}

/**
 * Tells the worker to delete its read cache (sale prices, staff names): logout, PIN login and the demo purge call it, so a shared phone
 * never serves the previous person's reads. The outbox is NOT cleared: held operations must survive. False when no worker controls the
 * page; the page then deletes the read cache itself (the cache is the same one the worker would delete).
 */
export function postClearUserData(
  nav: NavLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as NavLike),
  cacheStorage: { delete(name: string): Promise<boolean> } | undefined = typeof caches ===
  "undefined"
    ? undefined
    : caches,
): boolean {
  const controller = nav?.serviceWorker?.controller;
  if (!controller) {
    void cacheStorage?.delete("api-user").catch(() => false);
    return false;
  }
  controller.postMessage({ type: "clear-user-data" });
  return true;
}
