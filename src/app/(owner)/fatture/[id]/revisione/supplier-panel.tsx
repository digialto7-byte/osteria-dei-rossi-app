"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  ErrorAlert,
  Field,
  Select,
  SubHeading,
  TextInput,
  warningNoteClass,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { isForeignVat } from "@/lib/invoices/xml-review-view";
import { parseDecimal } from "@/lib/numbers/parse-decimal";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type { SupplierActions, SupplierOption } from "./actions";

const BOX = "flex w-full flex-col gap-3 rounded-lg border border-rule p-3";

/** Link a supplier you already have (the choice is confirmed by a button, never by the list itself). */
function LinkForm({
  suppliers,
  actions,
  confirmLabel,
  warning = false,
  onClose,
}: {
  suppliers: SupplierOption[];
  actions: Pick<SupplierActions, "link">;
  confirmLabel: string;
  warning?: boolean;
  onClose?: () => void;
}) {
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const failure = await actions.link(choice);
    setBusy(false);
    if (failure) setError(failure);
    else onClose?.();
  }

  return (
    <form method="post" onSubmit={submit} className={BOX}>
      {warning && <p className={warningNoteClass}>{t("review.supplier.relinkWarning")}</p>}
      <Field label={t("review.supplier.linkExisting")}>
        <Select value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">{t("review.supplier.choose")}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !choice}>
          {confirmLabel}
        </Button>
        {onClose && (
          <Button variant="quiet" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Changing the link clears the line mappings, so it warns first and needs a second tap. */
export function RelinkConfirm({
  suppliers,
  currentId,
  actions,
  onClose,
}: {
  suppliers: SupplierOption[];
  currentId: string;
  actions: Pick<SupplierActions, "link">;
  onClose: () => void;
}) {
  return (
    <LinkForm
      suppliers={suppliers.filter((supplier) => supplier.id !== currentId)}
      actions={actions}
      confirmLabel={t("review.supplier.confirm")}
      warning
      onClose={onClose}
    />
  );
}

function CreateForm({
  extracted,
  actions,
  fromXml = false,
}: {
  extracted: InvoiceReview["extractedSupplier"];
  actions: Pick<SupplierActions, "create">;
  /** The details come from an e-invoice file: its own hint, and a foreign VAT number is left out (the supplier takes Italian numbers only). */
  fromXml?: boolean;
}) {
  const foreign = fromXml && isForeignVat(extracted.vatNumber);
  const [name, setName] = useState(extracted.name ?? "");
  const [vat, setVat] = useState(foreign ? "" : (extracted.vatNumber ?? ""));
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const read = parseDecimal(days);
    if (!read.ok || (read.value !== null && !Number.isInteger(read.value))) {
      setError(t("review.error.number", { field: t("suppliers.paymentTerms") }));
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await actions.create({
      name: name.trim(),
      vatNumber: vat.trim() || null,
      paymentTermsDays: read.value,
    });
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <form method="post" onSubmit={submit} className={BOX} aria-label={t("review.supplier.create")}>
      <p className="text-sm text-ink-muted">
        {t(fromXml ? "review.supplier.createHintXml" : "review.supplier.createHint")}
      </p>
      <Field label={t("common.name")}>
        <TextInput
          value={name}
          maxLength={200}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label={t("suppliers.vatNumber")}
        hint={foreign ? t("review.xml.foreignVat") : t("suppliers.vatHint")}
      >
        <TextInput value={vat} maxLength={20} onChange={(e) => setVat(e.target.value)} />
      </Field>
      <Field label={t("suppliers.paymentTerms")}>
        <TextInput
          inputMode="numeric"
          autoComplete="off"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </Field>
      <ErrorAlert message={error} />
      <Button type="submit" disabled={busy || !name.trim()} className="self-start">
        {t("review.supplier.create")}
      </Button>
    </form>
  );
}

/**
 * Which supplier this invoice is from. Mappings are remembered per supplier, so the lines can be
 * mapped only once one is linked: link the suggestion or an existing supplier, or create one from
 * what the document printed.
 */
export function SupplierPanel({
  review,
  suppliers,
  actions,
}: {
  review: InvoiceReview;
  suppliers: SupplierOption[];
  actions: SupplierActions;
}) {
  const [relinking, setRelinking] = useState(false);
  if (!review.editable) return null;

  if (review.supplier) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="[overflow-wrap:anywhere]">
          <span className="font-bold">{review.supplier.name}</span>
          {review.supplier.vatNumber && (
            <span className="num">{` · ${review.supplier.vatNumber}`}</span>
          )}
        </p>
        {relinking ? (
          <RelinkConfirm
            suppliers={suppliers}
            currentId={review.supplier.id}
            actions={actions}
            onClose={() => setRelinking(false)}
          />
        ) : (
          <Button variant="secondary" aria-expanded="false" onClick={() => setRelinking(true)}>
            {t("review.supplier.change")}
          </Button>
        )}
      </div>
    );
  }

  const suggestion = review.supplierSuggestion;
  if (review.invoice.xml) {
    return (
      <XmlNewSupplier
        review={review}
        suggestion={suggestion}
        suppliers={suppliers}
        actions={actions}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className={`${warningNoteClass} text-sm`}>{t("review.supplier.needed")}</p>
      {suggestion && (
        <div className="flex flex-col items-start gap-2">
          <p>{t("review.supplier.suggestion", { name: suggestion.name })}</p>
          <SuggestionButton id={suggestion.id} name={suggestion.name} actions={actions} />
        </div>
      )}
      {suppliers.length > 0 && (
        <LinkForm
          suppliers={suppliers}
          actions={actions}
          confirmLabel={t("review.supplier.link")}
        />
      )}
      <CreateForm extracted={review.extractedSupplier} actions={actions} />
    </div>
  );
}

function SuggestionButton({
  id,
  name,
  actions,
}: {
  id: string;
  name: string;
  actions: Pick<SupplierActions, "link">;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="secondary" onClick={async () => setError(await actions.link(id))}>
        {t("review.supplier.linkSuggestion", { name })}
      </Button>
      <ErrorAlert message={error} />
    </>
  );
}

/**
 * An XML invoice whose supplier is not known yet: the file's name and VAT first, then "Crea fornitore" (the form opens in place,
 * prefilled) and "Collega un fornitore esistente". Approval stays blocked until one is linked, as for a photo.
 */
function XmlNewSupplier({
  review,
  suggestion,
  suppliers,
  actions,
}: {
  review: InvoiceReview;
  suggestion: InvoiceReview["supplierSuggestion"];
  suppliers: SupplierOption[];
  actions: SupplierActions;
}) {
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const { name, vatNumber } = review.extractedSupplier;
  return (
    <section className="flex flex-col gap-3">
      <SubHeading>{t("review.supplier.title")}</SubHeading>
      <p className={`${warningNoteClass} text-sm`}>{t("review.supplier.needed")}</p>
      <div className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
        <p className="font-bold">
          {t("review.xml.supplierNew", { name: name ?? t("invoices.xml.noSupplierName") })}
        </p>
        {vatNumber && (
          <p className="num text-sm text-ink-muted">
            {t("review.xml.supplierFromFile", { vat: vatNumber })}
          </p>
        )}
      </div>
      {suggestion && (
        <div className="flex flex-col items-start gap-2">
          <p>{t("review.supplier.suggestion", { name: suggestion.name })}</p>
          <SuggestionButton id={suggestion.id} name={suggestion.name} actions={actions} />
        </div>
      )}
      {creating ? (
        <CreateForm extracted={review.extractedSupplier} actions={actions} fromXml />
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          {t("review.supplier.create")}
        </Button>
      )}
      {suppliers.length > 0 &&
        (linking ? (
          <LinkForm
            suppliers={suppliers}
            actions={actions}
            confirmLabel={t("review.supplier.link")}
            onClose={() => setLinking(false)}
          />
        ) : (
          <Button variant="quiet" onClick={() => setLinking(true)}>
            {`${t("review.supplier.linkExisting")} ›`}
          </Button>
        ))}
    </section>
  );
}
