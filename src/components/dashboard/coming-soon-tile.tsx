import { Tile } from "@/components/dashboard/tile";
import { comingSoonLabel, type ComingSoonKey } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";

/** Placeholders for figures that need orders and bills: a label and a sentence, no number, no link, no chart. */
export function ComingSoonTile({ keys }: { keys: readonly ComingSoonKey[] }) {
  return (
    <Tile tileKey="comingSoon" title={t("dashboard.tile.comingSoon")}>
      <ul className="flex flex-col gap-2">
        {keys.map((key) => (
          <li key={key} className="flex flex-col">
            <span className="font-bold">{comingSoonLabel(key)}</span>
            <span className="text-ink-muted">{t("dashboard.comingSoon.text")}</span>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
