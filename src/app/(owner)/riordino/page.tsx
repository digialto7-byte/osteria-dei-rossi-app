"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { incompleteCount } from "@/lib/rules/rules-view";

const FORBIDDEN = 403;

interface Counts {
  incomplete: number;
  suppliers: number;
  recipes: number;
}

const cardLink =
  "block rounded-card border border-rule bg-surface p-4 font-bold text-ink shadow-[0_1px_0_rgb(0_0_0/0.03)] " +
  "transition-colors hover:border-rule-strong hover:bg-sunk";

/**
 * The entry to the reorder and prep rules: three cards that link to the ingredient, supplier and recipe screens, each
 * with a count read from /api/rules/*. A role that cannot read the rules (the waiter) sees one notice.
 */
export default function RiordinoPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [ingredients, suppliers, recipes] = await Promise.all([
        apiJson<{ items: { status: string }[] }>("/api/rules/ingredients"),
        apiJson<{ items: unknown[] }>("/api/rules/suppliers"),
        apiJson<{ items: unknown[] }>("/api/rules/recipes"),
      ]);
      if (!ingredients.ok || !suppliers.ok || !recipes.ok) {
        const failed = [ingredients, suppliers, recipes].find((result) => !result.ok);
        if (failed && !failed.ok) {
          setMessage(failed.status === FORBIDDEN ? t("rules.forbidden") : failed.error.message);
        }
        return;
      }
      setCounts({
        incomplete: incompleteCount(ingredients.data.items),
        suppliers: suppliers.data.items.length,
        recipes: recipes.data.items.length,
      });
    })();
  }, []);

  return (
    <>
      <Heading>{t("rules.title")}</Heading>
      <ErrorAlert message={message} />
      {counts === null ? (
        !message && <Muted>{t("common.loading")}</Muted>
      ) : (
        <div className="flex flex-col gap-3">
          <Link href="/riordino/ingredienti" className={cardLink}>
            {t("rules.home.ingredients", { count: counts.incomplete })}
          </Link>
          <Link href="/riordino/fornitori" className={cardLink}>
            {t("rules.home.suppliers", { count: counts.suppliers })}
          </Link>
          <Link href="/riordino/ricette" className={cardLink}>
            {t("rules.home.recipes", { count: counts.recipes })}
          </Link>
        </div>
      )}
    </>
  );
}
