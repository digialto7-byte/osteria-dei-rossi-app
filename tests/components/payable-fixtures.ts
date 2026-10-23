import type { PayableDetail, PayableItem } from "@/server/payables/types";

// Fake payables for the component tests (names and numbers are invented).
export const ITEM: PayableItem = {
  id: "90000000-0000-4000-8000-000000000001",
  invoiceId: "e1000000-0000-4000-8000-0000000000e1",
  invoiceNumber: "123/A",
  invoiceDate: "2026-12-01",
  supplierId: "5a000000-0000-4000-8000-00000000005a",
  supplierName: "Fornitore Demo Srl",
  amount: 1234.5,
  dueDate: "2026-12-10",
  status: "open",
  paidOn: null,
  daysToDue: 7,
  overdue: false,
};

export const DETAIL: PayableDetail = {
  payable: {
    ...ITEM,
    grossAmount: 1354.5,
    creditedAmount: 120,
    dueDateSource: "invoice",
    paidAt: null,
  },
  allowedStatuses: ["scheduled", "paid", "disputed"],
  canReversePayment: false,
  today: "2026-12-03",
  history: [
    {
      action: "created",
      fromStatus: null,
      toStatus: "open",
      paidOn: null,
      reason: null,
      at: "2026-12-01T09:00:00+00:00",
      byName: "Titolare Demo",
    },
  ],
};
