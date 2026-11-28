/**
 * SP3 step 19 (plan §3.7, UX C6): the console's home for «Torna alla console», or null when there is no console (CONSOLE_HOST unset, Q-P12). The scheme is the
 * venue app's own (APP_ORIGIN): https in production, http on the local stack (127.0.0.1:3000); https when APP_ORIGIN is unset.
 */
export function consoleHomeUrl(
  consoleHost: string | undefined,
  appOrigin: string | undefined,
): string | null {
  if (consoleHost === undefined) return null;
  const scheme =
    appOrigin !== undefined && URL.parse(appOrigin)?.protocol === "http:" ? "http" : "https";
  return `${scheme}://${consoleHost}/`;
}
