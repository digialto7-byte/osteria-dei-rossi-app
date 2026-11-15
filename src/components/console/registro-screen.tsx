"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FactList, FactRow } from "@/components/fact-list";
import { useConsoleShell } from "@/components/console/console-shell";
import { RawCode } from "@/components/console/raw-code";
import { ReadError } from "@/components/console/read-error";
import { useConsoleRead } from "@/components/console/use-console-read";
import {
  Button,
  ErrorAlert,
  Field,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  Select,
  SubHeading,
  TextInput,
} from "@/components/ui";
import {
  auditActionOptions,
  auditDetailEntries,
  auditListMeta,
  auditPlace,
  auditRequestPath,
  auditSentence,
  originLabel,
  parseRegistroQuery,
  registroHref,
  type RegistroQuery,
} from "@/lib/console/audit-view";
import { consoleApi, resetConsoleSwitch, type ConsoleFailure } from "@/lib/console/console-api";
import { EM_DASH, formatInstant, rangeProblem, romeToday } from "@/lib/console/console-dates";
import { failureMessage } from "@/lib/console/failure-message";
import { tenantOptions } from "@/lib/console/locali-view";
import { t } from "@/lib/i18n";
import type { AuditRow } from "@/lib/platform/api";
import { PLATFORM_AUDIT_ACTIONS } from "@/lib/platform/codes";

interface AuditPage {
  rows: AuditRow[];
  nextBefore: number | null;
}

/** The pages after the first, for one request path. They are ignored once the filters (and so the path) change. */
interface MorePages {
  path: string;
  /** The base read these pages follow: a restarted read (a round trip, «Riprova») drops them. */
  version: number;
  rows: AuditRow[];
  next: number | null;
  busy: boolean;
  error: ConsoleFailure | null;
}

const WRAP = "[overflow-wrap:anywhere]";
const sentenceOf = (row: AuditRow) => auditSentence(row.action) ?? row.action;

function AuditTable({
  rows,
  selectedId,
  onOpen,
}: {
  rows: AuditRow[];
  selectedId: number | null;
  onOpen: (id: number) => void;
}) {
  const heads = ["when", "place", "action", "origin"] as const;
  return (
    <div data-testid="audit-table" className="hidden lg:block">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-rule-strong">
            {heads.map((key) => (
              <th key={key} scope="col" className="px-3 py-2 font-bold">
                {t(`console.audit.col.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`relative border-b border-rule hover:bg-sunk${row.id === selectedId ? " bg-sunk" : ""}`}
            >
              <td className="px-3 py-1">
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="inline-flex min-h-tap items-center text-left font-bold text-accent-ink after:absolute after:inset-0"
                >
                  {formatInstant(row.at)}
                </button>
              </td>
              <td className={`px-3 py-2 ${WRAP}`}>{auditPlace(row)}</td>
              <td className="px-3 py-2">
                <div className={WRAP}>{sentenceOf(row)}</div>
                <div>
                  <RawCode code={row.action} />
                </div>
              </td>
              <td className="px-3 py-2">{originLabel(row.origin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditList({
  rows,
  hidden,
  onOpen,
}: {
  rows: AuditRow[];
  hidden: boolean;
  onOpen: (id: number) => void;
}) {
  return (
    <div data-testid="audit-list" className={hidden ? "hidden" : "lg:hidden"}>
      <LedgerList>
        {rows.map((row) => (
          <LedgerRow key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              className="flex min-h-tap w-full flex-col justify-center py-3 text-left"
            >
              <span data-slot="title" className={`font-bold text-ink ${WRAP}`}>
                {sentenceOf(row)}
              </span>
              <span data-slot="meta" className={`text-sm text-ink-muted ${WRAP}`}>
                {auditListMeta(row)}
              </span>
            </button>
          </LedgerRow>
        ))}
      </LedgerList>
    </div>
  );
}

/** The code, the time, the ids and the `detail` entries of one row: nothing else (UX §9). On a phone it replaces the list. */
function AuditDetailPanel({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [row.id]);
  return (
    <aside
      data-testid="audit-detail"
      className="flex flex-col gap-3 lg:sticky lg:top-4 lg:w-80 lg:shrink-0"
    >
      <SubHeading ref={heading} tabIndex={-1}>
        {t("console.audit.detail.title")}
      </SubHeading>
      <FactList>
        <FactRow label={t("console.audit.col.action")}>{row.action}</FactRow>
        <FactRow label={t("console.audit.col.when")}>{formatInstant(row.at)}</FactRow>
        <FactRow label={t("console.audit.col.place")}>{row.tenantId ?? EM_DASH}</FactRow>
        <FactRow label={t("console.audit.col.origin")}>{originLabel(row.origin)}</FactRow>
        {auditDetailEntries(row.detail).map(([key, value]) => (
          <FactRow key={key} label={key}>
            {value}
          </FactRow>
        ))}
      </FactList>
      <Button variant="quiet" className="self-start" onClick={onClose}>
        {t("console.audit.detail.close")}
      </Button>
    </aside>
  );
}

/**
 * The platform audit. The filters are typed here and written to the address; every request carries `dal` and `al`. A range the server would
 * refuse sends nothing and says why. The first page is one read; «Carica altri» reads the next page by its cursor and appends it.
 */
export function RegistroScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { tenants } = useConsoleShell();
  const [today] = useState(() => romeToday(new Date()));
  const [filters, setFilters] = useState<RegistroQuery>(() =>
    parseRegistroQuery(params, today, PLATFORM_AUDIT_ACTIONS),
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The address is the truth: when it changes from outside (a click on «Registro», back), the filters follow. The addresses this screen wrote
  // itself are remembered, so a slow address never undoes what is being chosen.
  const written = useRef<string[]>([]);
  const urlKey = params.toString();
  useEffect(() => {
    const fromUrl = parseRegistroQuery(new URLSearchParams(urlKey), today, PLATFORM_AUDIT_ACTIONS);
    const href = registroHref(fromUrl, today);
    const at = written.current.indexOf(href);
    if (at >= 0) written.current.splice(0, at + 1);
    else {
      written.current = [];
      setFilters(fromUrl);
      setSelectedId(null);
    }
  }, [urlKey, today]);
  const [more, setMore] = useState<MorePages | null>(null);

  const problem = rangeProblem(filters.dal, filters.al);
  const path = problem === null ? auditRequestPath(filters, null) : null;
  const { load, reload, version, busy } = useConsoleRead<AuditPage>(path);

  const currentPath = useRef(path);
  useEffect(() => {
    currentPath.current = path;
  }, [path]);
  const moreLatest = useRef(0);

  const change = (next: RegistroQuery) => {
    setFilters(next);
    setSelectedId(null);
    if (rangeProblem(next.dal, next.al) === null) {
      const href = registroHref(next, today);
      if (href !== registroHref(parseRegistroQuery(params, today, PLATFORM_AUDIT_ACTIONS), today))
        written.current.push(href);
      router.replace(href);
    }
  };

  const base = load.kind === "ready" ? load.data : null;
  const moreHere = more !== null && more.path === path && more.version === version ? more : null;
  const rows = base ? [...base.rows, ...(moreHere?.rows ?? [])] : [];
  const next = base ? (moreHere ? moreHere.next : base.nextBefore) : null;

  // A retry of a failed page keeps that error on screen while the page is read again (busy), so the pressed button keeps focus.
  function loadMore(keepError = false) {
    if (base === null || path === null || next === null) return;
    const cursor = next;
    const rowsSoFar = moreHere?.rows ?? [];
    const myPath = path;
    const mine = ++moreLatest.current;
    setMore({
      path: myPath,
      version,
      rows: rowsSoFar,
      next: cursor,
      busy: true,
      error: keepError ? (moreHere?.error ?? null) : null,
    });
    void consoleApi<AuditPage>(auditRequestPath(filters, cursor)).then((result) => {
      // A page that arrives after the filters changed, or after a newer request, is dropped.
      if (mine !== moreLatest.current || currentPath.current !== myPath) return;
      if (result.ok)
        setMore({
          path: myPath,
          version,
          rows: [...rowsSoFar, ...result.data.rows],
          next: result.data.nextBefore,
          busy: false,
          error: null,
        });
      else if (!result.leaving)
        setMore({
          path: myPath,
          version,
          rows: rowsSoFar,
          next: cursor,
          busy: false,
          error: result,
        });
    });
  }
  const retryMore = () => {
    resetConsoleSwitch();
    loadMore(true);
  };

  const localeOptions = [
    { value: "", label: t("console.audit.filter.allLocali") },
    ...(tenants.kind === "ready" ? tenantOptions(tenants.data) : []),
  ];
  if (filters.locale !== null && !localeOptions.some((o) => o.value === filters.locale)) {
    // A venue the list does not hold (still loading, or erased): the short id, as in the rows.
    localeOptions.push({
      value: filters.locale,
      label:
        tenants.kind === "ready"
          ? auditPlace({ tenantId: filters.locale, tenantName: null })
          : filters.locale.slice(0, 8),
    });
  }

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const problemText =
    problem === "order"
      ? t("console.audit.rangeOrder")
      : problem === "span"
        ? t("console.audit.rangeSpan")
        : problem === "invalid"
          ? t("console.audit.rangeInvalid")
          : null;

  return (
    <>
      <Heading>{t("console.audit.title")}</Heading>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("console.audit.filter.locale")}>
          <Select
            value={filters.locale ?? ""}
            onChange={(event) => change({ ...filters, locale: event.target.value || null })}
          >
            {localeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("console.audit.filter.action")}>
          <Select
            value={filters.azione ?? ""}
            onChange={(event) => change({ ...filters, azione: event.target.value || null })}
          >
            <option value="">{t("console.audit.filter.allActions")}</option>
            {auditActionOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("console.audit.filter.from")}>
          <TextInput
            type="date"
            value={filters.dal}
            onChange={(event) => change({ ...filters, dal: event.target.value })}
          />
        </Field>
        <Field label={t("console.audit.filter.to")}>
          <TextInput
            type="date"
            value={filters.al}
            onChange={(event) => change({ ...filters, al: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert message={problemText} />
      {problem === null && load.kind === "loading" && <Muted>{t("common.loading")}</Muted>}
      {problem === null && load.kind === "error" && (
        <ReadError
          message={failureMessage(load.failure, "console.audit.readError")}
          onRetry={reload}
          busy={busy}
        />
      )}
      {problem === null && base !== null && rows.length === 0 && (
        <Muted>{t("console.audit.empty")}</Muted>
      )}
      {problem === null && base !== null && rows.length > 0 && (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <AuditTable rows={rows} selectedId={selectedId} onOpen={setSelectedId} />
            <AuditList rows={rows} hidden={selected !== null} onOpen={setSelectedId} />
            {moreHere?.error && (
              <ReadError
                message={failureMessage(moreHere.error, "console.audit.readError")}
                onRetry={retryMore}
                busy={moreHere.busy}
              />
            )}
            {next !== null && !moreHere?.error && (
              <Button
                variant="secondary"
                className="self-start"
                disabled={moreHere?.busy === true}
                onClick={() => loadMore()}
              >
                {t("console.audit.more")}
              </Button>
            )}
          </div>
          {selected !== null && (
            <AuditDetailPanel row={selected} onClose={() => setSelectedId(null)} />
          )}
        </div>
      )}
    </>
  );
}
