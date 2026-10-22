/**
 * Whether a navigation tab is the current section for `pathname`: Home ("/") only on "/", any
 * other tab on its own path and every path below it ("/fatture", "/fatture/", "/fatture/x").
 * Matching is by whole path segments, so "/anagrafiche/importa" never marks a sibling tab.
 */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
