"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useConsoleShell } from "@/components/console/console-shell";
import { ReadError } from "@/components/console/read-error";
import {
  Button,
  Heading,
  LedgerList,
  LedgerRow,
  Muted,
  TextInput,
  linkClass,
} from "@/components/ui";
import { EM_DASH, formatActivityDay, romeToday } from "@/lib/console/console-dates";
import { venueHref } from "@/lib/console/console-nav";
import { failureMessage } from "@/lib/console/failure-message";
import {
  SORT_KEYS,
  ariaSort,
  digialtoWord,
  filterTenants,
  groupLabel,
  listMeta,
  localiHref,
  nextSort,
  parseLocaliQuery,
  peopleMeta,
  shownLine,
  sortTenants,
  type Sort,
  type SortKey,
} from "@/lib/console/locali-view";
import { t, tn, type MessageKey } from "@/lib/i18n";
import type { TenantSummary } from "@/lib/platform/api";

const COLUMN_LABELS: Record<SortKey, MessageKey> = {
  nome: "console.locali.col.name",
  gruppo: "console.locali.col.group",
  attivita: "console.locali.col.activity",
  digialto: "console.locali.col.digialto",
};

const WRAP = "[overflow-wrap:anywhere]";

function SortHeader({
  sortKey,
  sort,
  onSort,
}: {
  sortKey: SortKey;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
}) {
  const state = ariaSort(sort, sortKey);
  return (
    <th scope="col" aria-sort={state} className="p-0 text-left font-bold">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex min-h-tap items-center gap-1 px-3 text-left font-bold hover:bg-sunk"
      >
        {t(COLUMN_LABELS[sortKey])}
        <span aria-hidden="true">
          {state === "ascending" ? "▲" : state === "descending" ? "▼" : ""}
        </span>
      </button>
    </th>
  );
}

function LocaliTable({
  tenants,
  today,
  sort,
  onSort,
}: {
  tenants: TenantSummary[];
  today: string;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div data-testid="locali-table" className="hidden lg:block">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-rule-strong">
            {SORT_KEYS.map((key) => (
              <SortHeader key={key} sortKey={key} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant) => (
            <tr key={tenant.id} className="relative border-b border-rule hover:bg-sunk">
              <td className="px-3 py-2">
                <Link
                  href={venueHref(tenant.id)}
                  className={`${linkClass} ${WRAP} after:absolute after:inset-0`}
                >
                  {tenant.name}
                </Link>
                <p className="text-sm text-ink-muted">{peopleMeta(tenant.members)}</p>
              </td>
              <td className={`px-3 py-2 ${WRAP}`}>{groupLabel(tenant.organisation) ?? EM_DASH}</td>
              <td className="px-3 py-2">{formatActivityDay(tenant.lastActivityDate, today)}</td>
              <td className={`px-3 py-2${tenant.digialtoAttached ? "" : " font-bold"}`}>
                {digialtoWord(tenant.digialtoAttached)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LocaliList({ tenants, today }: { tenants: TenantSummary[]; today: string }) {
  return (
    <div data-testid="locali-list" className="lg:hidden">
      <LedgerList>
        {tenants.map((tenant) => (
          <LedgerRow key={tenant.id}>
            <Link
              href={venueHref(tenant.id)}
              className="flex min-h-tap flex-col justify-center py-3"
            >
              <span data-slot="title" className={`font-bold text-ink ${WRAP}`}>
                {tenant.name}
              </span>
              <span data-slot="meta" className={`text-sm text-ink-muted ${WRAP}`}>
                {listMeta(tenant, today)}
              </span>
            </Link>
          </LedgerRow>
        ))}
      </LedgerList>
    </div>
  );
}

/**
 * Locali, the console's home: every venue, sorted and searched on this device. The data is the shell's one read of the tenant list. The sort
 * lives in the address (so a reload keeps it); the search is typed here and written to the address too.
 */
export function LocaliScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { tenants, me, retryTenants } = useConsoleShell();
  const query = parseLocaliQuery(params);
  const [search, setSearch] = useState(query.search);
  const [today] = useState(() => romeToday(new Date()));

  const writeSearch = (value: string) => {
    setSearch(value);
    router.replace(localiHref({ sort: query.sort, search: value.trim() }));
  };
  const onSort = (key: SortKey) =>
    router.replace(localiHref({ sort: nextSort(query.sort, key), search: search.trim() }));

  const unread = me.kind === "ready" ? me.data.unreadNotices : 0;
  const all = tenants.kind === "ready" ? tenants.data : [];
  const shown = sortTenants(filterTenants(all, search), query.sort);

  return (
    <>
      <Heading>{t("console.locali.title")}</Heading>
      {unread > 0 && (
        <Link href="/avvisi" className={linkClass}>
          {tn("console.locali.unread", unread)}
        </Link>
      )}
      <TextInput
        type="search"
        aria-label={t("console.locali.search")}
        placeholder={t("console.locali.search")}
        value={search}
        disabled={tenants.kind !== "ready"}
        onChange={(event) => writeSearch(event.target.value)}
      />
      {tenants.kind === "loading" && <Muted>{t("common.loading")}</Muted>}
      {tenants.kind === "error" && (
        <ReadError
          message={failureMessage(tenants.failure, "console.locali.readError")}
          onRetry={retryTenants}
        />
      )}
      {tenants.kind === "ready" && shown.length === 0 && all.length > 0 && (
        <div className="flex flex-col items-start gap-3">
          <Muted>{t("console.locali.noMatch")}</Muted>
          <Button variant="quiet" onClick={() => writeSearch("")}>
            {t("console.locali.clearFilters")}
          </Button>
        </div>
      )}
      {tenants.kind === "ready" && shown.length > 0 && (
        <>
          <LocaliTable tenants={shown} today={today} sort={query.sort} onSort={onSort} />
          <LocaliList tenants={shown} today={today} />
        </>
      )}
      {tenants.kind === "ready" && (shown.length > 0 || all.length === 0) && (
        <Muted>{shownLine(shown.length, all.length)}</Muted>
      )}
    </>
  );
}
