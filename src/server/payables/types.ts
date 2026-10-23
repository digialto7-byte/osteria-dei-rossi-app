export const PAYABLE_STATUSES = ["open", "scheduled", "paid", "disputed"] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export const PAYABLE_FILTERS = ["unpaid", "paid", "all"] as const;
export type PayableFilter = (typeof PAYABLE_FILTERS)[number];

/** One row of the list, as public.payable_list builds it. Amounts are euros as JSON numbers. */
export interface PayableItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierId: string;
  supplierName: string;
  amount: number;
  dueDate: string;
  status: PayableStatus;
  paidOn: string | null;
  daysToDue: number;
  overdue: boolean;
}

export interface PayableTotals {
  count: number;
  amount: number;
}

export interface PayableHistoryEntry {
  action: string;
  fromStatus: PayableStatus | null;
  toStatus: PayableStatus | null;
  paidOn: string | null;
  reason: string | null;
  at: string;
  byName: string | null;
}

export interface PayableDetail {
  payable: PayableItem & {
    grossAmount: number;
    creditedAmount: number;
    dueDateSource: "invoice" | "supplier_terms";
    paidAt: string | null;
  };
  allowedStatuses: PayableStatus[];
  canReversePayment: boolean;
  history: PayableHistoryEntry[];
}

export interface PayableListResult {
  payables: PayableItem[];
  /** `YYYY-MM-DD_<uuid>`: pass it back as `?before=`. Null on the last page. */
  nextCursor: string | null;
  /** Over all unpaid rows (unpaid filter only). */
  totals: PayableTotals | null;
  today: string;
}

export interface SupplierStatement {
  supplier: { id: string; name: string; vatNumber: string | null };
  asOf: string;
  invoices: PayableItem[];
  credits: {
    payableId: string;
    invoiceId: string;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    creditedAmount: number;
  }[];
  totals: {
    invoicesTotal: number;
    creditsTotal: number;
    balance: number;
    disputedAmount: number;
  };
}
