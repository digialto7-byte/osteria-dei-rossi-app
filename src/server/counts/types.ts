import type { BaseUnit } from "@/server/stock/types";

export type CountType = "daily" | "monthly";
export type CountStatus = "open" | "closed" | "cancelled";

/** A colleague as the viewer may see them: the chef sees a name only for themself (null otherwise). */
export interface CountPerson {
  name: string | null;
  me: boolean;
}

export interface CountSession {
  id: string;
  type: CountType;
  status: CountStatus;
  location: { id: string; name: string };
  startedAt: string;
  startedBy: CountPerson;
  closedAt: string | null;
  closedBy: CountPerson | null;
  cancelledAt: string | null;
  linesTotal: number;
  linesCounted: number;
  linesWithDifference: number;
}

export interface CountLine {
  ingredientId: string;
  name: string;
  baseUnit: BaseUnit;
  position: number;
  /** The location total read now: for display only, never a balance. */
  expectedNowQty: number;
  expectedQty: number | null;
  countedQty: number | null;
  differenceQty: number | null;
  enteredAt: string | null;
}

export interface CountSessionDetail extends CountSession {
  /** Only on the answer of POST /api/counts. */
  resumed?: boolean;
  today: string;
  invoicesAwaitingApproval: number;
  lines: CountLine[];
}

export interface CountSessionsResult {
  sessions: CountSession[];
  nextCursor: string | null;
}

export interface CountLineEntry {
  ingredientId: string;
  expectedQty: number | null;
  countedQty: number | null;
  differenceQty: number | null;
  enteredAt: string | null;
}

export interface CloseResult {
  sessionId: string;
  closedAt: string;
  linesCounted: number;
  linesSkipped: number;
  linesWithDifference: number;
  lines: { ingredientId: string; differenceQty: number }[];
}

export interface CancelResult {
  sessionId: string;
  status: "cancelled";
  cancelledAt: string;
}

export interface CriticalItem {
  ingredientId: string;
  name: string;
  baseUnit: BaseUnit;
  isCritical: boolean;
}

export interface CriticalChange {
  ingredientId: string;
  isCritical: boolean;
  changed: boolean;
}

export interface VarianceLine {
  ingredientId: string;
  name: string;
  baseUnit: BaseUnit;
  expectedQty: number;
  countedQty: number;
  differenceQty: number;
  postedQty: number;
}

export interface Variance {
  session: CountSession;
  linesSkipped: number;
  lines: VarianceLine[];
}

/** The one count answer with euro values (owner and admin). A value is null, never 0, when a row has no cost. */
export interface VarianceCosts {
  sessionId: string;
  valueEur: number;
  lossEur: number;
  gainEur: number;
  unvaluedCount: number;
  lines: { ingredientId: string; valueEur: number | null }[];
}

export interface ReconciliationItem {
  ingredientId: string;
  name: string;
  baseUnit: BaseUnit;
  openingQty: number;
  receiptsQty: number;
  consumptionQty: number;
  wasteQty: number;
  transfersInQty: number;
  transfersOutQty: number;
  countAdjustmentsQty: number;
  otherQty: number;
  closingQty: number;
  balanced: boolean;
  countedQty: number | null;
  countedAt: string | null;
  countSessionId: string | null;
  afterCountQty: number | null;
  matchesCount: boolean | null;
}

export interface Reconciliation {
  from: string;
  to: string;
  location: { id: string; name: string };
  items: ReconciliationItem[];
}
