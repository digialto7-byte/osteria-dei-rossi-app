import Link from "next/link";
import type { ComponentProps } from "react";
import { needsFullLoad } from "@/lib/nav/full-load";

/**
 * A link of the app shell. A page that shows the QR as a `data:` image (P2-1 T-12) is a plain anchor, so the browser loads a new
 * document and gets that page's own CSP; every other link is a client navigation.
 * The props are deliberately narrow (no `prefetch`, no `onClick`): a caller cannot turn the full load back into a client navigation.
 */
export function NavLink({
  href,
  ...rest
}: Pick<ComponentProps<typeof Link>, "aria-current" | "className" | "children"> & {
  href: string;
}) {
  if (needsFullLoad(href)) {
    return (
      <a href={href} aria-current={rest["aria-current"]} className={rest.className}>
        {rest.children}
      </a>
    );
  }
  return <Link href={href} {...rest} />;
}
