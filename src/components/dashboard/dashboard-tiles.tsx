import { Fragment } from "react";
import { ComingSoonTile } from "@/components/dashboard/coming-soon-tile";
import { FixedCostsTile } from "@/components/dashboard/fixed-costs-tile";
import { FoodCostTile } from "@/components/dashboard/food-cost-tile";
import { PayablesTile } from "@/components/dashboard/payables-tile";
import { PlatesTile } from "@/components/dashboard/plates-tile";
import { PriceVarianceTile } from "@/components/dashboard/price-variance-tile";
import { StockRiskTile } from "@/components/dashboard/stock-risk-tile";
import { TodayListsTile } from "@/components/dashboard/today-lists-tile";
import { WasteTile } from "@/components/dashboard/waste-tile";
import { tileOrder, type TileKey } from "@/lib/dashboard/dashboard-view";
import type { DashboardOutput } from "@/server/dashboard/output";

/**
 * The tile grid of Oggi for the owner and the admin: one column on a phone, two on a laptop, three on a wide screen.
 * Which tiles and in which order is `tileOrder(role)`; the owner-only tiles are never rendered for the admin, whose
 * document does not carry them.
 */
export function DashboardTiles({ data }: { data: DashboardOutput }) {
  const render = (key: TileKey) => {
    const tiles = data.tiles;
    switch (key) {
      case "plates":
        return <PlatesTile tile={tiles.plates} />;
      case "foodCost":
        return <FoodCostTile tile={tiles.foodCost} />;
      case "payables":
        return <PayablesTile tile={tiles.payables} />;
      case "stockAtRisk":
        return <StockRiskTile tile={tiles.stockAtRisk} />;
      case "waste":
        return <WasteTile tile={tiles.waste} />;
      case "comingSoon":
        return <ComingSoonTile keys={data.comingSoon} />;
      case "todayLists":
        return data.role === "owner" ? <TodayListsTile tile={data.tiles.todayLists} /> : null;
      case "priceVariance":
        return data.role === "owner" ? <PriceVarianceTile tile={data.tiles.priceVariance} /> : null;
      case "fixedCosts":
        return data.role === "owner" ? <FixedCostsTile tile={data.tiles.fixedCosts} /> : null;
    }
  };
  return (
    <div data-testid="dashboard-tiles" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {tileOrder(data.role).map((key) => (
        <Fragment key={key}>{render(key)}</Fragment>
      ))}
    </div>
  );
}
