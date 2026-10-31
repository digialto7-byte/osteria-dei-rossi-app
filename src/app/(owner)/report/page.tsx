"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert, Heading, Muted, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { emptyText } from "@/lib/reports/report-view";
import type { AvtOutput, ItemsOutput, KpiReport, UnmappedOutput } from "@/server/reports/output";
import { AvtPanel, type AvtState } from "./avt-panel";
import { ItemsPanel } from "./items-panel";
import { KpiPanel } from "./kpi-panel";
import { PERIODI, PeriodPicker, type Periodo, type PeriodState } from "./period-picker";
import { UnmappedPanel } from "./unmapped-panel";

const FORBIDDEN = 403;
const NOT_FOUND = 404;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VISTE = ["andamento", "piatti", "scostamenti", "non-mappati"] as const;
type Vista = (typeof VISTE)[number];
const VISTA_LABEL = {
  andamento: "report.view.trend",
  piatti: "report.view.items",
  scostamenti: "report.view.variance",
  "non-mappati": "report.view.unmapped",
} as const;
const PERIOD_PARAM: Record<Periodo, string> = {
  giorno: "day",
  settimana: "week",
  mese: "month",
  periodo: "custom",
};

interface Params {
  vista: Vista;
  period: PeriodState;
  inventario: string | null;
}

const date = (value: string | null) => (value && DATE.test(value) ? value : null);

function readParams(search: URLSearchParams): Params {
  const vista = VISTE.find((v) => v === search.get("vista")) ?? "andamento";
  const requested = PERIODI.find((p) => p === search.get("periodo")) ?? "giorno";
  const dal = date(search.get("dal"));
  const al = date(search.get("al"));
  // A custom range stays "periodo" while it is incomplete, so its two date fields show; endpoint() fetches nothing until both ends are valid.
  const periodo = requested;
  const inventario = search.get("inventario");
  return {
    vista,
    period: { periodo, data: date(search.get("data")), dal, al },
    inventario: inventario && UUID.test(inventario) ? inventario : null,
  };
}

/** The one endpoint a view reads, with its query; null while a custom range lacks an end or ends before it starts (nothing to fetch yet). */
function endpoint(params: Params): string | null {
  const { vista, period } = params;
  if (vista === "scostamenti") {
    return params.inventario ? `/api/reports/avt?count=${params.inventario}` : "/api/reports/avt";
  }
  if (vista === "non-mappati") {
    return period.data
      ? `/api/reports/unmapped-items?week=${period.data}`
      : "/api/reports/unmapped-items";
  }
  if (period.periodo === "periodo" && !(period.dal && period.al && period.dal <= period.al)) {
    return null;
  }
  const base = vista === "andamento" ? "/api/reports/kpis" : "/api/reports/items";
  const query = [`period=${PERIOD_PARAM[period.periodo]}`];
  if (period.periodo === "periodo") query.push(`from=${period.dal}`, `to=${period.al}`);
  else if (period.data) query.push(`date=${period.data}`);
  return `${base}?${query.join("&")}`;
}

type Loaded =
  | { kind: "kpis"; data: KpiReport }
  | { kind: "items"; data: ItemsOutput }
  | { kind: "avt"; data: AvtOutput | null; state: AvtState }
  | { kind: "unmapped"; data: UnmappedOutput };

function ReportScreen({ params }: { params: Params }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useRef(latestOnly()).current;
  const path = endpoint(params);
  const { vista } = params;

  const load = useCallback(async () => {
    if (path === null) return;
    const isNewest = start();
    const result = await apiJson<unknown>(path);
    if (!isNewest()) return;
    if (result.ok) {
      setError(null);
      switch (vista) {
        case "andamento":
          return setLoaded({ kind: "kpis", data: result.data as KpiReport });
        case "piatti":
          return setLoaded({ kind: "items", data: result.data as ItemsOutput });
        case "scostamenti":
          return setLoaded({ kind: "avt", data: result.data as AvtOutput, state: "ok" });
        case "non-mappati":
          return setLoaded({ kind: "unmapped", data: result.data as UnmappedOutput });
      }
    }
    if (result.status === FORBIDDEN) return setForbidden(true);
    // The variance view reads "no monthly count yet" (404) and "no earlier count" (422) as what is missing, not as a failure.
    if (vista === "scostamenti" && result.status === NOT_FOUND && !params.inventario) {
      return setLoaded({ kind: "avt", data: null, state: "noCount" });
    }
    if (vista === "scostamenti" && result.error.code === "avt_no_opening_count") {
      return setLoaded({ kind: "avt", data: null, state: "noOpening" });
    }
    setError(result.error.message);
  }, [path, vista, params.inventario, start]);

  useEffect(() => {
    // Reading the report when the address changes is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const go = (search: Record<string, string | null>) => {
    const query = Object.entries<string | null>({ vista, ...search })
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    router.push(`/report?${query}`);
  };
  const changePeriod = (next: Partial<PeriodState> & { periodo: Periodo }) =>
    go({
      periodo: next.periodo,
      data: next.data ?? null,
      dal: next.dal ?? null,
      al: next.al ?? null,
    });

  if (forbidden) {
    return (
      <>
        <Heading>{t("report.heading")}</Heading>
        <ErrorAlert message={emptyText("reserved")} />
      </>
    );
  }
  return (
    <>
      <Heading>{t("report.heading")}</Heading>
      <nav aria-label={t("report.view.label")} className="flex flex-wrap gap-x-4 gap-y-1">
        {VISTE.map((view) => (
          <Link
            key={view}
            href={`/report?vista=${view}`}
            aria-current={view === vista ? "page" : undefined}
            className={`${linkClass} ${view === vista ? "font-bold" : ""}`}
          >
            {t(VISTA_LABEL[view])}
          </Link>
        ))}
      </nav>
      {vista === "andamento" || vista === "piatti" ? (
        <PeriodPicker state={params.period} onChange={changePeriod} />
      ) : null}
      <ErrorAlert message={error} />
      {path !== null && loaded === null && error === null ? (
        <Muted>{t("report.loading")}</Muted>
      ) : null}
      {loaded?.kind === "kpis" ? <KpiPanel report={loaded.data} /> : null}
      {loaded?.kind === "items" ? <ItemsPanel items={loaded.data} /> : null}
      {loaded?.kind === "avt" ? (
        <AvtPanel
          avt={loaded.data}
          state={loaded.state}
          onPick={(id) => router.push(`/report?vista=scostamenti&inventario=${id}`)}
        />
      ) : null}
      {loaded?.kind === "unmapped" ? (
        <UnmappedPanel
          data={loaded.data}
          onWeek={(day) => router.push(`/report?vista=non-mappati&data=${day}`)}
        />
      ) : null}
    </>
  );
}

function ReportRoute() {
  const search = useSearchParams();
  // A new address is a new screen: the key resets the loaded data and the error.
  return <ReportScreen key={search.toString()} params={readParams(search)} />;
}

export default function ReportPage() {
  return (
    <Suspense fallback={<Muted>{t("common.loading")}</Muted>}>
      <ReportRoute />
    </Suspense>
  );
}
