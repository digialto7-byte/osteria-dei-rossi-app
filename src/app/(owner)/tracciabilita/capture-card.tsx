import { Card } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { LotCapture } from "@/server/trace/output";

/** How many deliveries of the last 30 days carry a lot code, and per supplier (most missing first, as the API sends it). Numbers only. */
export function CaptureCard({ capture }: { capture: LotCapture }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="font-bold">{t("trace.capture.title")}</p>
      <p className="num">
        {t("trace.capture.line", { withCode: capture.withLotCode, lots: capture.lots })}
      </p>
      {capture.bySupplier.length > 0 ? (
        <details>
          <summary className="min-h-tap cursor-pointer py-2 font-bold">
            {t("trace.capture.bySupplier")}
          </summary>
          <ul className="flex flex-col gap-1">
            {capture.bySupplier.map((supplier) => (
              <li key={supplier.supplierId} className="num [overflow-wrap:anywhere]">
                {t("trace.capture.supplierLine", {
                  name: supplier.name,
                  withCode: supplier.withLotCode,
                  lots: supplier.lots,
                })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
