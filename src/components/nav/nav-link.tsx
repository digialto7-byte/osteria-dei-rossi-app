"use client";

import type { ComponentProps } from "react";
import { GuardedLink } from "@/components/nav/leave-guard";
import { needsFullLoad } from "@/lib/nav/full-load";

/**
 * A link of the app shell. A page that shows the QR as a `data:` image (P2-1 T-12) is a plain anchor, so the browser loads a new
 * document and gets that page's own CSP; every other link is a client navigation.
 * Both kinds ask the page's leave guard first (QW12: the comanda, with dishes not sent); the full load stays a full load when the guard lets go.
 * The props are deliberately narrow (no `prefetch`, no `onClick`): a caller cannot turn the full load back into a client navigation.
 */
export function NavLink({
  href,
  ...rest
}: Pick<ComponentProps<typeof GuardedLink>, "aria-current" | "className" | "children"> & {
  href: string;
}) {
  return <GuardedLink href={href} fullLoad={needsFullLoad(href)} {...rest} />;
}
