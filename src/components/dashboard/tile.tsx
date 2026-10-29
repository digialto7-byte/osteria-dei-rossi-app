import Link from "next/link";
import type { ReactNode } from "react";
import { linkClass } from "@/components/ui";

export const ROW_LINK =
  "flex min-h-tap items-center justify-between gap-3 py-2.5 transition-colors hover:bg-sunk";

/**
 * One tile of the owner dashboard (plan §3.4): a bordered section labelled by its heading, the content, and ONE link to
 * the screen that acts on it. It is not one big link, because tiles hold lists with links of their own. It is not a
 * `Card`, so the page keeps its two-Card limit. The heading is Figtree bold 18 px, not Bodoni.
 */
export function Tile({
  tileKey,
  title,
  href,
  linkLabel,
  children,
}: {
  tileKey: string;
  title: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  const headingId = `tile-${tileKey}-title`;
  return (
    <section
      data-tile={tileKey}
      aria-labelledby={headingId}
      className="reveal flex min-w-0 flex-col gap-3 rounded-card border border-rule bg-surface p-4"
    >
      <h2 id={headingId} className="text-[1.125rem] leading-tight font-bold text-ink">
        {title}
      </h2>
      {children}
      {href && linkLabel ? (
        <div className="mt-auto">
          <Link href={href} className={linkClass}>
            {linkLabel}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
