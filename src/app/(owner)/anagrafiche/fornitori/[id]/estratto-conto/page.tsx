"use client";

import { BackLink } from "@/components/back-link";
import { use, useEffect, useState } from "react";
import { ErrorAlert, Heading, Muted } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import type { SupplierStatement } from "@/server/payables/types";
import { StatementView } from "./statement-view";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** The statement of one supplier. Reads /api/suppliers/:id/statement only. */
export default function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiJson<SupplierStatement>(`/api/suppliers/${id}/statement`).then((result) => {
      if (result.ok) return setStatement(result.data);
      if (result.status === FORBIDDEN) setMessage(t("payables.forbidden"));
      else if (result.status === NOT_FOUND) setMessage(t("payables.notFound"));
      else setMessage(result.error.message);
    });
  }, [id]);

  return (
    <>
      <BackLink href={`/anagrafiche/fornitori/${id}`}>{t("statement.back")}</BackLink>
      {statement ? (
        <StatementView statement={statement} />
      ) : (
        <>
          <Heading>{t("statement.title")}</Heading>
          {message ? <ErrorAlert message={message} /> : <Muted>{t("common.loading")}</Muted>}
        </>
      )}
    </>
  );
}
