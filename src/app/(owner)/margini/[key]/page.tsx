"use client";

import { use, useEffect, useState } from "react";
import { BackLink } from "@/components/back-link";
import { PlateBreakdownView } from "@/components/cost/plate-breakdown";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { ChefPlateBreakdown } from "@/server/costing/plate-breakdown";

const FORBIDDEN = 403;

/**
 * One plate of the margins, split by line: percentages and words, nothing in euro (V6). Reads /api/costs/plates/:key
 * with no query; the chef's document has no euro field, and the view is drawn without money whoever opens it.
 */
export default function MarginDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [breakdown, setBreakdown] = useState<ChefPlateBreakdown | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await apiJson<ChefPlateBreakdown>(`/api/costs/plates/${key}`);
      if (cancelled) return;
      if (result.ok) return setBreakdown(result.data);
      setMessage(result.status === FORBIDDEN ? t("margins.forbidden") : result.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!breakdown) {
    return (
      <>
        {/* A role that may not read the margins is given no link into them. */}
        {message !== t("margins.forbidden") && (
          <BackLink href="/margini">{t("margins.back")}</BackLink>
        )}
        <Heading>{t("margins.title")}</Heading>
        <ErrorAlert message={message} />
        {!message && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }
  return (
    <>
      <BackLink href="/margini">{t("margins.back")}</BackLink>
      <div className="[overflow-wrap:anywhere]">
        <Heading>{breakdown.name}</Heading>
      </div>
      <PlateBreakdownView breakdown={breakdown} />
    </>
  );
}
