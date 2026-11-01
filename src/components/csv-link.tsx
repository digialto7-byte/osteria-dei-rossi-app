"use client";

import { linkClass } from "@/components/ui";
import { useMe } from "@/components/use-me";
import { canExport } from "@/lib/exports/export-access";
import { t } from "@/lib/i18n";

/**
 * "Scarica CSV" (M24 plan §3.1.10): a plain download link to an export, drawn for the owner and the admin only. Display only: the export route
 * answers 403 to anyone else before any query. A normal link, not a client navigation: the browser saves the file the server names.
 */
export function CsvLink({ href, label }: { href: string; label?: string }) {
  const role = useMe().me?.user.role;
  if (!canExport(role)) return null;
  return (
    <a href={href} download className={`${linkClass} self-start`}>
      {label ?? t("export.csv")}
    </a>
  );
}
