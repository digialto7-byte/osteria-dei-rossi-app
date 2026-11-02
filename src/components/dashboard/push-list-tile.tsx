import { Tile } from "@/components/dashboard/tile";
import { Badge, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { moreCount, tileEmpty, tileHeadline } from "@/lib/dashboard/dashboard-view";
import { t, tn } from "@/lib/i18n";
import { pushedPlateText, pushLine } from "@/lib/push/push-view";
import type { OwnerDashboard } from "@/server/dashboard/output";

type PushList = OwnerDashboard["tiles"]["pushList"];

/**
 * "Da spingere oggi" (M23 plan §3.5): the dishes and ingredients whose use-by is within a day, soonest first, as the PRD sentence. Owner and admin
 * both see the euro. The database ordered, valued and capped the rows; the tile only prints them. Expired stock is never offered as a push: it is
 * counted ("N scaduti da scartare"), and the list screen links to where it is thrown away. One link, to the list.
 */
export function PushListTile({ tile }: { tile: PushList }) {
  const empty = tileEmpty("pushList", { pushList: tile });
  const expired = tile.expired.batches + tile.expired.lots;
  const more = moreCount(tile.count, tile.items.length);
  return (
    <Tile
      tileKey="pushList"
      title={t("dashboard.tile.pushList")}
      href={tile.href}
      linkLabel={t("dashboard.link.pushList")}
      headline={tileHeadline("pushList", { pushList: tile })}
    >
      {empty ? (
        <Muted>{t(empty)}</Muted>
      ) : (
        <LedgerList>
          {tile.items.map((item) => (
            <LedgerRow key={item.id}>
              <div data-push-row-id={item.id} className="flex flex-col gap-1 py-2.5">
                <span className="num">{pushLine(item, "owner")}</span>
                {item.plates
                  .filter((plate) => plate.pushed)
                  .map((plate) => (
                    <Badge key={plate.menuItemId} tone="success">
                      <span className="sr-only">{plate.name}: </span>
                      {pushedPlateText(true)}
                    </Badge>
                  ))}
              </div>
            </LedgerRow>
          ))}
        </LedgerList>
      )}
      {more > 0 ? <Muted>{t("dashboard.push.more", { count: more })}</Muted> : null}
      {expired > 0 ? <Muted>{tn("dashboard.push.expired", expired)}</Muted> : null}
    </Tile>
  );
}
