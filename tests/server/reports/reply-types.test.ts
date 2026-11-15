import { describe, expectTypeOf, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { withBusinessDate } from "@/server/reports/business-date";
import type {
  ItemsOutput,
  ItemsReply,
  KpiReport,
  KpiReportReply,
  WithBusinessDate,
} from "@/server/reports/output";
import type { ServicesReport, ServicesReportReply } from "@/server/services/output";

// The reply types of the three report routes the period picker reads (#137): the report plus the venue's business date. Builder 2's page reads
// `businessDate` for the picker's max through these, not through an ad hoc cast.
describe("the report reply types", () => {
  it("each reply is its report plus a string businessDate", () => {
    expectTypeOf<KpiReportReply>().toEqualTypeOf<KpiReport & { businessDate: string }>();
    expectTypeOf<ItemsReply>().toEqualTypeOf<ItemsOutput & { businessDate: string }>();
    expectTypeOf<ServicesReportReply>().toEqualTypeOf<ServicesReport & { businessDate: string }>();
    expectTypeOf<KpiReportReply["businessDate"]>().toEqualTypeOf<string>();
  });

  it("withBusinessDate returns WithBusinessDate of its report", () => {
    expectTypeOf<Awaited<ReturnType<typeof withBusinessDate<KpiReport>>>>().toEqualTypeOf<
      WithBusinessDate<KpiReport>
    >();
    expectTypeOf<Parameters<typeof withBusinessDate>[0]>().toEqualTypeOf<SupabaseClient>();
  });
});
