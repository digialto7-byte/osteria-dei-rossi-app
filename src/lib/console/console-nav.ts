import type { MessageKey } from "@/lib/i18n";

// The console is served on its own host: every path here is the VISIBLE one ("/registro"), never "/console/registro".

export type ConsoleSection = "locali" | "registro" | "avvisi";

export const CONSOLE_SECTIONS: readonly {
  key: ConsoleSection;
  href: "/" | "/registro" | "/avvisi";
  labelKey: MessageKey;
}[] = [
  { key: "locali", href: "/", labelKey: "console.nav.locali" },
  { key: "registro", href: "/registro", labelKey: "console.nav.registro" },
  { key: "avvisi", href: "/avvisi", labelKey: "console.nav.avvisi" },
];

const within = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** The section a visible path belongs to; null for the sign-in pages and anything else. */
export function currentSection(pathname: string): ConsoleSection | null {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  if (path === "/" || within(path, "/locali")) return "locali";
  if (within(path, "/registro")) return "registro";
  if (within(path, "/avvisi")) return "avvisi";
  return null;
}

export function venueHref(id: string): string {
  return `/locali/${id}`;
}
