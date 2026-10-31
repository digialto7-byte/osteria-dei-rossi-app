import type { BillLine, BillOutput, BillReceipt, CloseOutput } from "@/server/bill/output";
import type { CloseBody } from "@/server/bill/schemas";
import type { AppVsRegister, EnterDayCloseOutput } from "@/server/day-close/output";

// Fake bill and day-close payloads in the exact shapes the SQL returns (M21 plan §3.2, §3.5). Fake data only; the AT2 table totals 100,00 €.

export const BIDS = {
  session: "14000000-0000-4000-8000-000000000001",
  line1: "15000000-0000-4000-8000-000000000001",
  line2: "15000000-0000-4000-8000-000000000002",
  line3: "15000000-0000-4000-8000-000000000003",
  line4: "15000000-0000-4000-8000-000000000004",
  waiter: "d1000000-0000-4000-8000-00000000000d",
  other: "14000000-0000-4000-8000-000000000002",
} as const;

export const TOKEN = "0123456789abcdef0123456789abcdef";

export const BILL_LINES: BillLine[] = [
  {
    id: BIDS.line3,
    name: "Tagliatelle al ragù (demo)",
    course: "primi",
    qty: 1.5,
    unitPrice: 12.5,
    amount: 18.75,
    state: "fired",
    isShared: false,
  },
  {
    id: BIDS.line1,
    name: "Spezzatino con polenta (demo)",
    course: "secondi",
    qty: 2,
    unitPrice: 14,
    amount: 28,
    state: "fired",
    isShared: false,
  },
  {
    id: BIDS.line2,
    name: "Spezzatino con polenta (demo)",
    course: "secondi",
    qty: 0.5,
    unitPrice: 14,
    amount: 7,
    state: "fired",
    isShared: false,
  },
  {
    id: BIDS.line4,
    name: "Vino rosso (demo)",
    course: "bevande",
    qty: 1,
    unitPrice: 40.25,
    amount: 40.25,
    state: "fired",
    isShared: true,
  },
];

export const BILL: BillOutput = {
  sessionId: BIDS.session,
  tableName: "Tavolo 1 (demo)",
  covers: 3,
  closed: false,
  billToken: TOKEN,
  lines: BILL_LINES,
  coperto: { perPerson: 2, covers: 3, amount: 6 },
  subtotal: 94,
  total: 100,
  unsentLineIds: [],
  split: null,
  receipt: null,
};

export const BILL_BY_COVERS: BillOutput = {
  ...BILL,
  split: {
    mode: "covers",
    parts: [
      { index: 1, amount: 33.34 },
      { index: 2, amount: 33.33 },
      { index: 3, amount: 33.33 },
    ],
  },
};

export const BILL_BY_ITEMS: BillOutput = {
  ...BILL,
  split: {
    mode: "items",
    parts: [
      { index: 1, covers: 1, lineIds: [BIDS.line1], sharedAmount: 13.42, amount: 43.42 },
      { index: 2, covers: 1, lineIds: [BIDS.line3], sharedAmount: 13.42, amount: 34.17 },
      { index: 3, covers: 1, lineIds: [BIDS.line2], sharedAmount: 13.41, amount: 22.41 },
    ],
  },
};

export const RECEIPT: BillReceipt = {
  type: "scontrino",
  number: "0012-0034",
  paymentType: "card",
  missingReceipt: false,
  closedAt: "2026-11-04T22:10:00+00:00",
  closedBy: { id: BIDS.waiter, displayName: "Cameriere Demo" },
  businessDate: "2026-11-04",
};

export const BILL_CLOSED: BillOutput = { ...BILL, closed: true, receipt: RECEIPT };
export const CLOSE_REPLY: CloseOutput = { changed: true, bill: BILL_CLOSED };

export const CLOSE_BODY: CloseBody = {
  receiptType: "scontrino",
  receiptNumber: "0012-0034",
  paymentType: "card",
  billToken: TOKEN,
};

const BY_RECEIPT: AppVsRegister["app"]["byReceiptType"] = [
  { type: "scontrino", total: 1134.5, tables: 2 },
  { type: "fattura", total: 100, tables: 1 },
];
const BY_PAYMENT: AppVsRegister["app"]["byPaymentType"] = [
  { type: "cash", total: 134.5, tables: 1 },
  { type: "card", total: 1000, tables: 1 },
  { type: "other", total: 100, tables: 1 },
];

export const REPORT: AppVsRegister = {
  businessDate: "2026-11-04",
  asOf: "2026-11-04T22:30:00+00:00",
  app: {
    total: 1234.5,
    tables: 3,
    covers: 6,
    byReceiptType: BY_RECEIPT,
    byPaymentType: BY_PAYMENT,
  },
  register: {
    total: 1222,
    enteredAt: "2026-11-04T22:25:00+00:00",
    enteredBy: { id: "a1000000-0000-4000-8000-00000000000a", displayName: "Titolare Demo" },
    entries: 1,
  },
  difference: { amount: 12.5, pct: 1 },
  missingReceipts: [
    {
      sessionId: BIDS.other,
      tableName: "Tavolo 2 (demo)",
      covers: 2,
      closedAt: "2026-11-04T23:40:00+00:00",
      closedBy: { id: BIDS.waiter, displayName: "Cameriere Demo" },
      receiptType: "scontrino",
      paymentType: "cash",
      total: 134.5,
    },
  ],
  openTables: { count: 2, provisionalTotal: 32 },
  lateOps: { count: 2 },
};

export const REPORT_NO_REGISTER: AppVsRegister = { ...REPORT, register: null, difference: null };
export const ENTER_REPLY: EnterDayCloseOutput = { changed: true, report: REPORT };
