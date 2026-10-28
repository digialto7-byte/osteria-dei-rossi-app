"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  TextInput,
} from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { emptyFor } from "@/lib/empty/empty-content";
import { useApiList } from "@/components/use-api-list";
import { useMe } from "@/components/use-me";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { canEditMasterData } from "@/lib/master/master-access";

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
  // Only owner and admin write master data (the API refuses the others); until the role is known no form shows.
  const role = useMe().me?.user.role ?? null;
  const canEdit = role !== null && canEditMasterData(role);

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
      {canEdit && (
        <Card>
          <form onSubmit={create} className="flex flex-col gap-4" aria-label={t("suppliers.new")}>
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
        </Card>
      )}
      <ErrorAlert message={list.error} />
      <Checkbox
        label={t("common.showInactive")}
        checked={list.showInactive}
        onChange={(e) => list.setShowInactive(e.target.checked)}
      />
      {list.items === null ? (
        <Muted>{t("common.loading")}</Muted>
      ) : list.items.length === 0 ? (
        <EmptyState {...emptyFor("suppliers", role)} />
      ) : (
        <LedgerList>
          {list.items.map((supplier) => (
            <LedgerRow key={supplier.id}>
              <Link
                href={`/anagrafiche/fornitori/${supplier.id}`}
                className="group -mx-2 flex min-h-tap items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-sunk"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold [overflow-wrap:anywhere] group-hover:underline group-hover:underline-offset-4">
                    {supplier.name}
                  </span>
                  <span className="num text-sm text-ink-muted">
                    {supplier.vatNumber ?? "—"}
                    {!supplier.isActive && ` (${t("common.inactive")})`}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-ink-muted transition-transform group-hover:translate-x-0.5"
                >
                  ›
                </span>
              </Link>
            </LedgerRow>
          ))}
        </LedgerList>
      )}
    </>
  );
}
