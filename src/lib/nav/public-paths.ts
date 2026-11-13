/**
 * True for the pages a guest reaches without an account: the booking page `/prenota/<slug>` and what hangs under it. The header
 * band's name is not a link there, because "/" sends a signed-out guest to the staff sign-in (UX quick wins QW1, finding F01).
 * `/login`, `/pin` and `/dispositivo` are staff pages and keep the link.
 */
export function isGuestPath(pathname: string): boolean {
  return pathname.startsWith("/prenota/");
}
