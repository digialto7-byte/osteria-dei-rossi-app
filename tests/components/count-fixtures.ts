import type { CountLine, CountSession } from "@/server/counts/types";

// Fake data only ("(demo)" names, invented quantities).
export const SESSION_ID = "51000000-0000-4000-8000-000000000001";
export const CELLA = "10000000-0000-4000-8000-0000000000a1";
export const FREEZER = "10000000-0000-4000-8000-0000000000a2";
export const ING = "1a000000-0000-4000-8000-00000000001a";

export const SESSION: CountSession = {
  id: SESSION_ID,
  type: "daily",
  status: "closed",
  location: { id: CELLA, name: "Cella (demo)" },
  startedAt: "2026-10-23T08:12:00+00:00",
  startedBy: { name: "Chef Demo", me: false },
  closedAt: "2026-10-23T08:40:00+00:00",
  closedBy: { name: "Chef Demo", me: false },
  cancelledAt: null,
  linesTotal: 20,
  linesCounted: 18,
  linesWithDifference: 3,
};

export const LINE: CountLine = {
  ingredientId: ING,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  position: 1,
  expectedNowQty: 12.3,
  expectedQty: null,
  countedQty: null,
  differenceQty: null,
  enteredAt: null,
};
