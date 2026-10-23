"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorAlert, Heading, Muted, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import type { BatchProposal, ProduceResult } from "@/server/batches/types";
import { negativesKey } from "../negatives";
import { ProductionForm, type ProduceRequest } from "./production-form";

const FORBIDDEN = 403;

interface RecipeOption {
  key: string;
  name: string;
}

/**
 * "Nuova produzione". Reads the active batch recipes (/api/recipes?type=batch), the proposal
 * (/api/batches/proposal) and writes through POST /api/batches; scaling, FEFO, the lot code and the cost are the
 * server's. On success it opens the label text; a shortfall the production recorded is handed to that page.
 */
export default function NewProductionPage() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeOption[] | null>(null);
  const [proposal, setProposal] = useState<BatchProposal | null>(null);
  const [serial, setSerial] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorIds, setErrorIds] = useState<string[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const startRequest = useRef(latestOnly()).current;

  useEffect(() => {
    void (async () => {
      const result = await apiJson<{ recipes: RecipeOption[] }>("/api/recipes?type=batch");
      if (!result.ok) {
        if (result.status === FORBIDDEN) setForbidden(true);
        else setError(result.error.message);
        return;
      }
      setRecipes(result.data.recipes);
    })();
  }, []);

  async function calculate(recipeKey: string, outputQty: number) {
    const isNewest = startRequest();
    setBusy(true);
    setError(null);
    setErrorIds([]);
    const result = await apiJson<BatchProposal>(
      `/api/batches/proposal?recipeKey=${recipeKey}&outputQty=${outputQty}`,
    );
    if (!isNewest()) return;
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setProposal(result.data);
    setSerial((n) => n + 1);
  }

  // A new shelf life only refreshes the use-by preview: what the chef typed is kept.
  async function refreshShelfLife(hours: number) {
    if (!proposal) return;
    const isNewest = startRequest();
    const result = await apiJson<BatchProposal>(
      `/api/batches/proposal?recipeKey=${proposal.recipe.key}&outputQty=${proposal.outputQty}&shelfLifeHours=${hours}`,
    );
    if (!isNewest() || !result.ok) return;
    setProposal({
      ...proposal,
      useByPreview: result.data.useByPreview,
      shelfLifeHours: result.data.shelfLifeHours,
    });
  }

  async function register(request: ProduceRequest) {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    setErrorIds([]);
    const result = await apiJson<ProduceResult>("/api/batches", { method: "POST", body: request });
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      setErrorIds(
        (result.error.details ?? []).flatMap((d) =>
          d.ingredientId ? [String(d.ingredientId)] : [],
        ),
      );
      return;
    }
    // The shortfall notes of the label page: names are resolved here, from the proposal the chef saw.
    const notes = result.data.negatives.map((negative) => ({
      ingredient: proposal.inputs.find((i) => i.ingredientId === negative.ingredientId)?.name ?? "",
      location: proposal.locations.find((l) => l.id === negative.locationId)?.name ?? "",
      qty: negative.onHandQty,
      unit: proposal.inputs.find((i) => i.ingredientId === negative.ingredientId)?.baseUnit ?? "kg",
    }));
    if (notes.length > 0) {
      window.sessionStorage.setItem(negativesKey(result.data.batchId), JSON.stringify(notes));
    }
    router.push(`/produzione/${result.data.batchId}/etichetta?nuovo=1`);
  }

  if (forbidden) {
    return (
      <>
        <Heading>{t("production.new")}</Heading>
        <ErrorAlert message={t("production.forbidden")} />
        <BackLink />
      </>
    );
  }
  return (
    <>
      <Heading>{t("production.new")}</Heading>
      {recipes === null ? (
        <>
          <ErrorAlert message={error} />
          {!error && <Muted>{t("production.loadingRecipes")}</Muted>}
        </>
      ) : recipes.length === 0 ? (
        <Muted>{t("production.noRecipes")}</Muted>
      ) : (
        <ProductionForm
          key={serial}
          recipes={recipes}
          proposal={proposal}
          busy={busy}
          error={error}
          errorIngredientIds={errorIds}
          onCalculate={calculate}
          onShelfLife={refreshShelfLife}
          onSubmit={register}
        />
      )}
      <BackLink />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/produzione" className={`${linkClass} self-start`}>
      ← {t("production.title")}
    </Link>
  );
}
