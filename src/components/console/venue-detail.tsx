"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BackLink } from "@/components/back-link";
import { FactList, FactRow } from "@/components/fact-list";
import { RawCode } from "@/components/console/raw-code";
import { ReadError } from "@/components/console/read-error";
import { useConsoleRead } from "@/components/console/use-console-read";
import { Heading, LedgerList, LedgerRow, Muted, SubHeading, linkClass } from "@/components/ui";
import { auditSentence, registroHref } from "@/lib/console/audit-view";
import { EM_DASH, defaultRange, formatInstant, romeToday } from "@/lib/console/console-dates";
import { failureMessage } from "@/lib/console/failure-message";
import { detailMeta, healthSentence, peopleLine } from "@/lib/console/locali-view";
import { t } from "@/lib/i18n";
import type { AuditRow, TenantDetail } from "@/lib/platform/api";

const NOT_FOUND_CODES = ["tenant_not_found", "not_found"];
const SECTION = "flex flex-col gap-3";

function Section({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`${SECTION} ${className}`}>
      <SubHeading>{title}</SubHeading>
      {children}
    </section>
  );
}

function ActivityRow({ row }: { row: AuditRow }) {
  const sentence = auditSentence(row.action);
  return (
    <LedgerRow className="flex flex-col gap-0.5 py-3">
      <span className="text-sm text-ink-muted">{formatInstant(row.at)}</span>
      <span className="[overflow-wrap:anywhere]">{sentence ?? row.action}</span>
      <RawCode code={row.action} />
    </LedgerRow>
  );
}

/**
 * A venue, in metadata only (names, counts, dates, codes). On the phone the sections run Salute, Utilizzo, Attività, Impostazioni (UX C9);
 * from lg the settings take the wide left column. Salute exists only while DigiAlto is not attached to the venue.
 */
export function VenueDetail({ id }: { id: string }) {
  const { load, reload, busy } = useConsoleRead<{ tenant: TenantDetail; activity: AuditRow[] }>(
    `/api/platform/tenants/${encodeURIComponent(id)}`,
  );
  const [today] = useState(() => romeToday(new Date()));

  const back = <BackLink href="/">{t("console.detail.back")}</BackLink>;
  // While the name is not known (loading, a failed read) the one h1 is «Locali», the screen's section (key console.detail.back).
  const placeholder = <Heading>{t("console.detail.back")}</Heading>;
  if (load.kind === "loading")
    return (
      <>
        {back}
        {placeholder}
        <Muted>{t("common.loading")}</Muted>
      </>
    );
  if (load.kind === "error") {
    if (NOT_FOUND_CODES.includes(load.failure.error.code))
      return (
        <>
          {back}
          <Heading>{t("console.detail.notFound")}</Heading>
        </>
      );
    return (
      <>
        {back}
        {placeholder}
        <ReadError
          message={failureMessage(load.failure, "console.detail.readError")}
          onRetry={reload}
          busy={busy}
        />
      </>
    );
  }

  const { tenant, activity } = load.data;
  const health = healthSentence(tenant.digialtoAttached);
  return (
    <>
      {back}
      <header className="flex flex-col gap-3">
        <Heading>{tenant.name}</Heading>
        <Muted>{detailMeta(tenant)}</Muted>
        {tenant.digialtoAttached && <Muted>{t("console.detail.attached")}</Muted>}
      </header>
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,640px)_minmax(0,360px)] lg:gap-x-10">
        {health !== null && (
          <Section title={t("console.detail.health.title")} className="lg:col-start-2">
            <p>{health}</p>
          </Section>
        )}
        <Section title={t("console.detail.usage.title")} className="lg:col-start-2">
          <FactList>
            <FactRow label={t("console.detail.usage.people")}>
              {peopleLine(tenant.members, tenant.digialtoAttached)}
            </FactRow>
          </FactList>
        </Section>
        <Section title={t("console.detail.activity.title")} className="lg:col-start-2">
          {activity.length === 0 ? (
            <Muted>{t("console.detail.activity.empty")}</Muted>
          ) : (
            <LedgerList>
              {activity.map((row) => (
                <ActivityRow key={row.id} row={row} />
              ))}
            </LedgerList>
          )}
          <Link
            href={registroHref({ ...defaultRange(today), locale: tenant.id, azione: null }, today)}
            className={linkClass}
          >
            {t("console.detail.activity.all")}
          </Link>
        </Section>
        <Section
          title={t("console.detail.settings.title")}
          className="lg:col-start-1 lg:row-span-3 lg:row-start-1"
        >
          <FactList>
            <FactRow label={t("console.detail.settings.name")}>{tenant.name}</FactRow>
            <FactRow label={t("console.detail.settings.timeZone")}>{tenant.timeZone}</FactRow>
            <FactRow label={t("console.detail.settings.bookingSlug")}>
              {tenant.bookingSlug ?? EM_DASH}
            </FactRow>
          </FactList>
        </Section>
      </div>
    </>
  );
}
