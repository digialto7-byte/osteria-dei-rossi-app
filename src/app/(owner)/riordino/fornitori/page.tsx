"use client";

import { BackLink } from "@/components/back-link";
import { ErrorAlert, Heading, Muted, SuccessNote } from "@/components/ui";
import { useHashScroll } from "@/components/use-hash-scroll";
import { t } from "@/lib/i18n";
import { supplierFacets } from "@/lib/nav/facet-links";
import { canEditRules } from "@/lib/rules/rules-view";
import type { SupplierRulesItem } from "@/server/rules/output";
import { SupplierRuleCard, type SupplierRulesPatch } from "../supplier-rule-card";
import { useRules } from "../use-rules";

/** The delivery rules of every supplier. Reads and writes /api/rules/suppliers; the next window is the server's. */
export default function RuleSuppliersPage() {
  const rules = useRules<{ items: SupplierRulesItem[] }>("/api/rules/suppliers");
  const canEdit = rules.role !== null && canEditRules(rules.role);
  useHashScroll(rules.data !== null);

  if (rules.forbidden) {
    return (
      <>
        <Heading>{t("rules.suppliers.title")}</Heading>
        <ErrorAlert message={t("rules.forbidden")} />
      </>
    );
  }
  return (
    <>
      <BackLink href="/riordino">{t("rules.back")}</BackLink>
      <Heading>{t("rules.suppliers.title")}</Heading>
      <Muted>{t("rules.suppliers.hint")}</Muted>
      <ErrorAlert message={rules.error} />
      {rules.saved && <SuccessNote role="status">{t("rules.saved")}</SuccessNote>}
      {rules.data === null ? (
        !rules.error && <Muted>{t("common.loading")}</Muted>
      ) : rules.data.items.length === 0 ? (
        <Muted>{t("rules.suppliers.empty")}</Muted>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.data.items.map((item) => (
            <SupplierRuleCard
              key={item.supplierId}
              item={item}
              canEdit={canEdit}
              facets={supplierFacets(item.supplierId, rules.role, "rules")}
              busy={rules.busyId === item.supplierId}
              error={rules.errors[item.supplierId] ?? null}
              onSave={(patch: SupplierRulesPatch) =>
                void rules.save(item.supplierId, "/api/rules/suppliers", {
                  supplierId: item.supplierId,
                  ...patch,
                })
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
