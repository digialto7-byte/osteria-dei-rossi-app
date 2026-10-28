// Presentation helpers for the demo banner and the purge page. Pure: they only decide what to show; the server
// (route and Postgres) decides what is allowed.

/** The banner is shown for a demo tenant only. */
export const showBanner = (isDemo: boolean | undefined): boolean => isDemo === true;

/** Only the owner of a demo tenant may delete its data. Mirrors the route (owner) and purge_demo_tenant. */
export const canPurge = (role: string, isDemo: boolean): boolean => isDemo && role === "owner";

/** The typed text must equal the tenant name exactly: nothing is trimmed, case counts. */
export const confirmMatches = (typed: string, name: string): boolean =>
  name !== "" && typed === name;
