"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Checkbox, ErrorAlert, Field, Heading, TextInput } from "@/components/ui";
import { useApiList } from "@/components/use-api-list";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";

interface Supplier {
  id: string;
  name: string;
  vatNumber: string | null;
  paymentTermsDays: number | null;
  isActive: boolean;
}

const EMPTY_FORM = { name: "", vatNumber: "", paymentTermsDays: "" };

export default function SuppliersPage() {
  const list = useApiList<Supplier>("/api/suppliers", "suppliers");
  const [form, setForm] = useState(EMPTY_FORM);

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await apiJson("/api/suppliers", {
      method: "POST",
      body: {
        name: form.name,
        vatNumber: form.vatNumber.trim() || null,
        ...(form.paymentTermsDays ? { paymentTermsDays: Number(form.paymentTermsDays) } : {}),
      },
    });
    if (!result.ok) return list.setError(result.error.message);
    setForm(EMPTY_FORM);
    await list.reload();
  }

  return (
    <>
      <Heading>{t("suppliers.title")}</Heading>
      <form onSubmit={create} className="flex flex-col gap-3" aria-label={t("suppliers.new")}>
        <Field label={t("common.name")}>
          <TextInput
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={200}
          />
        </Field>
        <Field label={t("suppliers.vatNumber")} hint={t("suppliers.vatHint")}>
          <TextInput
            value={form.vatNumber}
            onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
            autoCapitalize="characters"
            maxLength={20}
          />
        </Field>
        <Field label={t("suppliers.paymentTerms")}>
          <TextInput
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            value={form.paymentTermsDays}
            onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
          />
        </Field>
        <Button type="submit">{t("common.add")}</Button>
      </form>
      <ErrorAlert message={list.error} />
      <Checkbox
        label={t("common.showInactive")}
        checked={list.showInactive}
        onChange={(e) => list.setShowInactive(e.target.checked)}
      />
      {list.items === null ? (
        <p>{t("common.loading")}</p>
      ) : list.items.length === 0 ? (
        <p>{t("common.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-stone-200">
          {list.items.map((supplier) => (
            <li key={supplier.id}>
              <Link
                href={`/anagrafiche/fornitori/${supplier.id}`}
                className="flex min-h-tap flex-col justify-center py-2 underline-offset-2 hover:underline"
              >
                <span className="font-medium">{supplier.name}</span>
                <span className="text-sm text-stone-600">
                  {supplier.vatNumber ?? "—"}
                  {!supplier.isActive && ` (${t("common.inactive")})`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
