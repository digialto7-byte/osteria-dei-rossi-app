import Link from "next/link";
import type { ReactNode } from "react";
import { linkClass } from "@/components/ui";

/**
 * The way back to a screen's parent, drawn as the first thing in the page so it is never after a long history. The
 * chevron is decoration: a screen reader reads the label only.
 */
export function BackLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className={`${linkClass} self-start`}>
      <span aria-hidden="true" className="inline-block">
        ‹
      </span>
      {children}
    </Link>
  );
}
