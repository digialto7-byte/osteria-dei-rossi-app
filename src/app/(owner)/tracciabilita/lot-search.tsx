"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, Field, Muted, Select, TextInput } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { lotSearchQuery, type LotFilters } from "@/lib/trace/trace-view";
import type { TraceLotSearch } from "@/server/trace/output";
import { LotResults } from "./lot-results";
import { searchErrorText } from "./trace-errors";

const FORBIDDEN = 403;
const EMPTY: LotFilters = { q: "", ingredientId: "", supplierId: "", from: "", to: "" };
// The search lives in the address so Back and a shared link reopen it (spec D5).
const PARAMS = {
  q: "lotto",
  ingredientId: "ingrediente",
  supplierId: "fornitore",
  from: "dal",
  to: "al",
} as const;

interface Named {
  id: string;
  name: string;
  isActive?: boolean;
}

function filtersFromAddress(search: string): LotFilters {
  const params = new URLSearchParams(search);
  const read = (key: keyof LotFilters) => params.get(PARAMS[key]) ?? "";
  return {
    q: read("q"),
    ingredientId: read("ingredientId"),
    supplierId: read("supplierId"),
    from: read("from"),
    to: read("to"),
  };
}

function rememberInAddress(filters: LotFilters) {
  const url = new URL(window.location.href);
  for (const key of Object.keys(PARAMS) as (keyof LotFilters)[]) {
    const value = key === "q" ? filters.q.trim() : filters[key];
    if (value) url.searchParams.set(PARAMS[key], value);
    else url.searchParams.delete(PARAMS[key]);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * "Da un lotto" (spec §3): the lot code first, and a disclosure for ingredient, supplier and dates. Reads /api/trace/lots; the typed filters go
 * to the API as they are (trimmed), nothing is guessed. Offline the form is disabled: a search is never answered from a stored copy.
 */
export function LotSearch({ online, onForbidden }: { online: boolean; onForbidden: () => void }) {
  const [filters, setFilters] = useState<LotFilters>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ data: TraceLotSearch; byCode: boolean } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<Named[]>([]);
  const [suppliers, setSuppliers] = useState<Named[]>([]);
  const codeRef = useRef<HTMLInputElement>(null);
  const start = useRef(latestOnly()).current;

  const run = useCallback(
    async (next: LotFilters) => {
      setFieldError(null);
      setDateError(null);
      const query = lotSearchQuery(next);
      if (query === null) {
        setFieldError(t("trace.err.query"));
        codeRef.current?.focus();
        return;
      }
      rememberInAddress(next);
      setLoading(true);
      const isNewest = start();
      const reply = await apiJson<TraceLotSearch>(`/api/trace/lots?${query}`);
      if (!isNewest()) return;
      setLoading(false);
      if (reply.ok) return setResult({ data: reply.data, byCode: next.q.trim() !== "" });
      if (reply.status === FORBIDDEN) return onForbidden();
      setResult(null);
      const { text, onDates } = searchErrorText(reply.error);
      if (onDates) {
        setDateError(text);
        setOpen(true);
      } else setFieldError(text);
    },
    [onForbidden, start],
  );

  useEffect(() => {
    // Reading the lists and a search named in the address, when the tab opens, is the effect's job here.
    void (async () => {
      const [ingredientReply, supplierReply] = await Promise.all([
        apiJson<{ ingredients: Named[] }>("/api/ingredients"),
        apiJson<{ suppliers: Named[] }>("/api/suppliers"),
      ]);
      if (ingredientReply.ok)
        setIngredients(ingredientReply.data.ingredients.filter((row) => row.isActive !== false));
      if (supplierReply.ok)
        setSuppliers(supplierReply.data.suppliers.filter((row) => row.isActive !== false));
    })();
    const named = filtersFromAddress(window.location.search);
    if (lotSearchQuery(named) === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(named);
    setOpen(
      named.ingredientId !== "" || named.supplierId !== "" || named.from !== "" || named.to !== "",
    );
    void run(named);
  }, [run]);

  const set = (key: keyof LotFilters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  return (
    <>
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (online) void run(filters);
        }}
      >
        <Field label={t("trace.q.label")} hint={t("trace.q.hint")}>
          <TextInput
            ref={codeRef}
            value={filters.q}
            onChange={(event) => set("q")(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={64}
            disabled={!online}
          />
        </Field>
        <ErrorAlert message={fieldError} />
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary className="min-h-tap cursor-pointer py-2 font-bold">{t("trace.more")}</summary>
          <div className="flex flex-col gap-4 pt-2">
            <Field label={t("trace.ingredient")}>
              <Select
                value={filters.ingredientId}
                onChange={(event) => set("ingredientId")(event.target.value)}
                disabled={!online}
              >
                <option value="">{t("trace.any")}</option>
                {ingredients.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("trace.supplier")}>
              <Select
                value={filters.supplierId}
                onChange={(event) => set("supplierId")(event.target.value)}
                disabled={!online}
              >
                <option value="">{t("trace.any")}</option>
                {suppliers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("trace.from")}>
              <TextInput
                type="date"
                value={filters.from}
                onChange={(event) => set("from")(event.target.value)}
                disabled={!online}
              />
            </Field>
            <Field label={t("trace.to")}>
              <TextInput
                type="date"
                value={filters.to}
                onChange={(event) => set("to")(event.target.value)}
                disabled={!online}
              />
            </Field>
            <ErrorAlert message={dateError} />
          </div>
        </details>
        {!online && <Muted>{t("trace.offline")}</Muted>}
        <Button type="submit" disabled={!online || loading}>
          {t("trace.search")}
        </Button>
      </form>
      {loading ? (
        <Muted>{t("common.loading")}</Muted>
      ) : result ? (
        <LotResults result={result.data} byCode={result.byCode} onTryOther={() => setOpen(true)} />
      ) : null}
    </>
  );
}
