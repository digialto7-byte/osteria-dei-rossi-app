"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorAlert, Heading, linkClass, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import {
  emptyFixedCostForm,
  fieldErrors,
  fixedCostsView,
  rulesFormFrom,
  toFixedCostBody,
  toSettingsPatch,
  type FieldErrors,
  type FixedCostFormState,
  type RulesFormState,
} from "@/lib/costing/cost-forms";
import { t } from "@/lib/i18n";
import type { CostSettings, FixedCostPeriod } from "@/server/costing/types";
import { CostRulesForm } from "./cost-rules-form";
import { FixedCostForm } from "./fixed-cost-form";

const FORBIDDEN = 403;

/**
 * The cost rules (owner and admin) and the monthly fixed costs (owner only: the API answers 403 to
 * everyone else, and then the form is not shown at all).
 */
export default function CostSettingsPage() {
  const [rules, setRules] = useState<RulesFormState | null>(null);
  const [rulesErrors, setRulesErrors] = useState<FieldErrors>({});
  const [rulesSaved, setRulesSaved] = useState(false);
  const [fixed, setFixed] = useState<FixedCostFormState>(emptyFixedCostForm());
  const [fixedErrors, setFixedErrors] = useState<FieldErrors>({});
  const [fixedSaved, setFixedSaved] = useState(false);
  const [periods, setPeriods] = useState<FixedCostPeriod[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: a later save must not clear the reason the fixed-cost form is missing.
  const [periodsError, setPeriodsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPeriods = useCallback(async () => {
    const result = await apiJson<{ periods: FixedCostPeriod[] }>("/api/fixed-costs");
    // 403 is the answer for everyone but the owner: the fixed-cost form is simply not theirs. Any
    // other failure is shown, not hidden.
    const view = fixedCostsView(result);
    if (view.kind === "form") {
      setPeriods(view.periods);
      setPeriodsError(null);
    } else if (view.kind === "error") setPeriodsError(view.message);
  }, []);

  useEffect(() => {
    // Loading when the page opens is the effect's job here.
    void (async () => {
      const result = await apiJson<CostSettings>("/api/settings");
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setRules(rulesFormFrom(result.data));
      await loadPeriods();
    })();
  }, [loadPeriods]);

  async function saveRules() {
    if (!rules) return;
    setRulesSaved(false);
    const parsed = toSettingsPatch(rules);
    if (!parsed.ok) return setRulesErrors(parsed.errors);
    setBusy(true);
    const result = await apiJson<CostSettings>("/api/settings", {
      method: "PATCH",
      body: parsed.body,
    });
    setBusy(false);
    if (!result.ok) {
      setRulesErrors(fieldErrors(result.error.details));
      if (!result.error.details) setError(result.error.message);
      return;
    }
    setError(null);
    setRulesErrors({});
    setRules(rulesFormFrom(result.data));
    setRulesSaved(true);
  }

  async function saveFixed() {
    setFixedSaved(false);
    const parsed = toFixedCostBody(fixed);
    if (!parsed.ok) return setFixedErrors(parsed.errors);
    setBusy(true);
    const result = await apiJson("/api/fixed-costs", { method: "POST", body: parsed.body });
    setBusy(false);
    if (!result.ok) {
      setFixedErrors(fieldErrors(result.error.details));
      if (!result.error.details) setError(result.error.message);
      return;
    }
    setError(null);
    setFixedErrors({});
    setFixedSaved(true);
    await loadPeriods();
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("costs.settings.title")}</Heading>
        <ErrorAlert message={t("costError.forbidden")} />
      </>
    );
  }

  return (
    <>
      <Heading>{t("costs.settings.title")}</Heading>
      <ErrorAlert message={periodsError} />
      <ErrorAlert message={error} />
      {periods !== null && (
        <FixedCostForm
          state={fixed}
          errors={fixedErrors}
          periods={periods}
          busy={busy}
          saved={fixedSaved}
          onChange={setFixed}
          onSubmit={() => void saveFixed()}
        />
      )}
      {rules === null ? (
        !error && <Muted>{t("common.loading")}</Muted>
      ) : (
        <CostRulesForm
          state={rules}
          errors={rulesErrors}
          busy={busy}
          saved={rulesSaved}
          onChange={setRules}
          onSubmit={() => void saveRules()}
        />
      )}
      <Link href="/costi" className={linkClass}>
        {t("costs.recipe.back")}
      </Link>
    </>
  );
}
