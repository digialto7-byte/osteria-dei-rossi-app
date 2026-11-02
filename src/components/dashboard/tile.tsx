"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";

export const ROW_LINK =
  "flex min-h-tap items-center justify-between gap-3 py-2.5 transition-colors hover:bg-sunk";

/**
 * Whether tiles start open. False in the app (M25b: every tile starts collapsed, on every width). The component tests that are about the
 * content of a tile's body render it open through this provider, so they do not depend on a click.
 */
export const TileDefaultOpen = createContext(false);

/**
 * One tile of the owner dashboard (plan §3.4): a bordered section labelled by its heading, and ONE link to the screen that acts on it. It is
 * not one big link, because tiles hold lists with links of their own. It is not a `Card`, so the page keeps its two-Card limit. The heading
 * is Figtree bold 18 px, not Bodoni.
 *
 * M25b: a tile with a `headline` is compact. It always shows the heading, the one-line headline, its link and a 44 px "Dettagli" button;
 * the body (`children`: lists, tables, charts) is rendered only while open, so a closed tile's links are not in the accessibility tree. A tile
 * without a headline (the "In arrivo" tile) shows its content as it always did.
 */
export function Tile({
  tileKey,
  title,
  href,
  linkLabel,
  headline,
  children,
}: {
  tileKey: string;
  title: string;
  href?: string;
  linkLabel?: string;
  headline?: string | null;
  children?: ReactNode;
}) {
  const headingId = `tile-${tileKey}-title`;
  const bodyId = `tile-${tileKey}-body`;
  const [open, setOpen] = useState(useContext(TileDefaultOpen));
  const compact = typeof headline === "string";
  return (
    <section
      data-tile={tileKey}
      aria-labelledby={headingId}
      className="reveal flex min-w-0 flex-col gap-3 rounded-card border border-rule bg-surface p-4"
    >
      <h2 id={headingId} className="text-[1.125rem] leading-tight font-bold text-ink">
        {title}
      </h2>
      {compact && (
        <p data-headline className="num">
          {headline}
        </p>
      )}
      {!compact && children}
      {(href && linkLabel) || compact ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4">
          {href && linkLabel ? (
            <Link href={href} className={linkClass}>
              {linkLabel}
            </Link>
          ) : (
            <span />
          )}
          {compact && (
            <Button
              variant="quiet"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-describedby={headingId}
              onClick={() => setOpen((value) => !value)}
            >
              {t("dashboard.details")}
            </Button>
          )}
        </div>
      ) : null}
      {compact && open && (
        <div id={bodyId} className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </section>
  );
}
