// Demo data (docs/plans/2026-10-24-demo-data.md §3.3): one invented osteria week, as pure data.
// Every value is made up. Every name ends in "(demo)" (the tenant and the role labels are the fixed exceptions), no supplier,
// person, price or address is real, and nothing comes from docs/client/. Dates are OFFSETS in days from `today` (Rome); the seed turns
// them into dates with calendar arithmetic (dates.ts), so the demo looks current on any day it is seeded. Rows are named by KEY; the seed maps each key to the
// id the database returned and never finds a row by its position.

/** The fixed labels that are not "(demo)" names: the tenant and the unit/role words the fixture uses. */
export const TENANT_NAME = "Osteria Demo (dati di prova)";
export const TENANT_VAT = "IT00000000099";
export const ADMIN_EMAIL = "supporto.demo@osteria-demo.invalid";
export const OWNER_LOCAL_EMAIL = "titolare.demo@example.test";
/** The pdf text, and what `demoInvoicePdf` says on the page. */
export const PDF_TEXT = "FATTURA DI PROVA (demo) - senza valore fiscale";

export type Unit = "kg" | "l" | "pz";

export interface StaffMember {
  key: string;
  name: string;
  role: "chef" | "waiter";
}
export interface Device {
  key: string;
  label: string;
  /** The owner revokes it after it is enrolled. */
  revoke: boolean;
  /** The chef signs in through this one (its token is discarded at the end). */
  kitchen: boolean;
}
export interface Location {
  key: string;
  name: string;
}
export interface Supplier {
  key: string;
  name: string;
  vat: string;
  paymentTermsDays: number;
  /** ISO weekdays, Monday = 1. */
  deliveryWeekdays: number[];
  orderCutoffTime: string | null;
  leadTimeDays: number;
}
export interface Ingredient {
  key: string;
  name: string;
  unit: Unit;
  isStock: boolean;
  category: string;
  /** The location the stock arrives in, and the kitchen takes it from. Null for the non-stock one. */
  home: string | null;
  /** Confirmed allergens (the app's codes), or an empty list for "none". */
  allergens: string[];
}
export interface InvoiceLine {
  ingredient: string;
  description: string;
  code: string;
  qty: number;
  unit: Unit;
  unitPrice: number;
  lotCode?: string;
  /** Days from today. */
  expiryOffset?: number;
}
export interface DemoInvoice {
  key: string;
  supplier: string;
  number: string;
  /** Days from today (negative = past). */
  dateOffset: number;
  dueOffset: number;
  /** Where the approval receives the goods. */
  location: string;
  approve: boolean;
  paid: boolean;
  lines: InvoiceLine[];
}
export interface RecipeLine {
  ingredient?: string;
  recipe?: string;
  qty: number;
  unit: "kg" | "l" | "pz" | "porz" | "g" | "ml";
}
export interface RecipeVersion {
  lines: RecipeLine[];
}
export interface DemoRecipe {
  key: string;
  type: "sub" | "batch" | "plate";
  name: string;
  outputQty?: number;
  outputUnit?: "kg" | "l" | "pz";
  portionsPerBatch?: number;
  shelfLifeHours?: number;
  salePrice?: number;
  /** Version 1 first; a second entry is created as a new version. */
  versions: RecipeVersion[];
  rules?: { minPortions: number; targetPortions: number };
}
export interface Production {
  key: string;
  recipe: string;
  outputQty: number;
}

export interface DemoFixture {
  today: string;
  tenant: { name: string; vat: string };
  owner: { name: string };
  admin: { name: string; email: string };
  staff: StaffMember[];
  devices: Device[];
  locations: Location[];
  suppliers: Supplier[];
  ingredients: Ingredient[];
  invoices: DemoInvoice[];
  costSettings: { price_variance_pct: number };
  fixedCosts: { month: string; rent: number; labour: number; utilities: number };
  recipes: DemoRecipe[];
  ingredientRules: { ingredient: string; minLevel: number; targetLevel: number }[];
  critical: string[];
  staffMealRule: { recipe: string; defaultCount: number };
  stockOps: {
    transfers: { ingredient: string; qty: number; unit: Unit; from: string; to: string }[];
    waste: { ingredient: string; qty: number; unit: Unit; reason: string; location: string }[];
    manualUse: { ingredient: string; qty: number; unit: Unit; location: string }[];
  };
  productions: Production[];
  batchActions: {
    split: { from: string; portions: number; hoursFromNow: number; location: string };
    discard: { from: string; portions: number; reason: string };
    staffMeal: { count: number };
    adjust: { from: string; byPortions: number };
  };
  count: {
    location: string;
    type: "daily";
    counted: { ingredient: string; qty: number; unit: Unit }[];
  };
  expected: Expected;
}

export interface Expected {
  /** After everything, including the count adjustment: ingredient key -> location key -> quantity. */
  onHand: Record<string, Record<string, number>>;
  portions: { ragu: number; crema: number };
  variance: { ingredient: string; expected: number; counted: number; difference: number }[];
  alertKinds: string[];
  payables: Record<string, "overdue" | "due_soon" | "paid" | "open">;
  invoicesApproved: number;
  invoicesInReview: number;
}

/** Whole cents of a decimal amount. */
export const cents = (amount: number) => Math.round(amount * 100);

export function lineAmount(line: InvoiceLine): number {
  return cents(line.qty * line.unitPrice) / 100;
}
/** Net, VAT (10 %) and gross of an invoice, exact to the cent. */
export function invoiceTotals(invoice: DemoInvoice): { net: number; vat: number; gross: number } {
  const net = invoice.lines.reduce((sum, line) => sum + cents(lineAmount(line)), 0);
  const vat = Math.round(net * 0.1);
  return { net: net / 100, vat: vat / 100, gross: (net + vat) / 100 };
}

export function buildFixture(today: string): DemoFixture {
  const ingredients: Ingredient[] = [
    ing("manzo", "Manzo macinato (demo)", "kg", "Carne", "cella", []),
    ing("guanciale", "Guanciale (demo)", "kg", "Salumi", "cella", []),
    ing("cipolla", "Cipolla (demo)", "kg", "Verdura", "dispensa", []),
    ing("carota", "Carota (demo)", "kg", "Verdura", "dispensa", []),
    ing("sedano", "Sedano bianco (demo)", "kg", "Verdura", "dispensa", ["sedano"]),
    ing("passata", "Passata di pomodoro (demo)", "l", "Dispensa", "dispensa", []),
    ing("vino", "Vino rosso da stufato (demo)", "l", "Dispensa", "dispensa", []),
    ing("latte", "Latte intero (demo)", "l", "Latticini", "cella", ["latte"]),
    ing("uova", "Uova (demo)", "pz", "Latticini", "cella", ["uova"]),
    ing("zucchero", "Zucchero semolato (demo)", "kg", "Dispensa", "cella", []),
    ing("farina", "Farina bianca (demo)", "kg", "Dispensa", "cella", ["glutine"]),
    {
      key: "acqua",
      name: "Acqua (demo)",
      unit: "l",
      isStock: false,
      category: "Altro",
      home: null,
      allergens: [],
    },
  ];

  const invoices: DemoInvoice[] = [
    {
      key: "f1",
      supplier: "macelleria",
      number: "DEMO-F1",
      dateOffset: -35,
      dueOffset: -5,
      location: "cella",
      approve: true,
      paid: false,
      lines: [
        {
          ingredient: "manzo",
          description: "Manzo macinato (demo)",
          code: "MAN-10",
          qty: 10,
          unit: "kg",
          unitPrice: 9.8,
        },
        {
          ingredient: "guanciale",
          description: "Guanciale (demo)",
          code: "GUA-02",
          qty: 2,
          unit: "kg",
          unitPrice: 14.5,
          lotCode: "G-01",
          expiryOffset: 10,
        },
      ],
    },
    {
      key: "f2",
      supplier: "macelleria",
      number: "DEMO-F2",
      dateOffset: -3,
      dueOffset: 27,
      location: "cella",
      approve: true,
      paid: false,
      lines: [
        {
          ingredient: "manzo",
          description: "Manzo macinato (demo)",
          code: "MAN-10",
          qty: 8,
          unit: "kg",
          unitPrice: 10.9,
        },
      ],
    },
    {
      key: "f3",
      supplier: "ortofrutta",
      number: "DEMO-F3",
      dateOffset: -27,
      dueOffset: 3,
      location: "dispensa",
      approve: true,
      paid: false,
      lines: [
        line("cipolla", "Cipolla (demo)", "CIP-05", 5, "kg", 1.2),
        line("carota", "Carota (demo)", "CAR-03", 3, "kg", 1.1),
        line("sedano", "Sedano bianco (demo)", "SED-02", 2, "kg", 1.8),
        line("passata", "Passata di pomodoro (demo)", "PAS-12", 12, "l", 1.4),
        line("vino", "Vino rosso da stufato (demo)", "VIN-06", 6, "l", 2.5),
      ],
    },
    {
      key: "f4",
      supplier: "latteria",
      number: "DEMO-F4",
      dateOffset: -2,
      dueOffset: 28,
      location: "cella",
      approve: true,
      paid: true,
      lines: [
        {
          ingredient: "latte",
          description: "Latte intero (demo)",
          code: "LAT-04",
          qty: 4,
          unit: "l",
          unitPrice: 1.3,
          lotCode: "L-01",
          expiryOffset: 1,
        },
        line("uova", "Uova (demo)", "UOV-18", 18, "pz", 0.3),
        line("zucchero", "Zucchero semolato (demo)", "ZUC-02", 2, "kg", 1),
        line("farina", "Farina bianca (demo)", "FAR-05", 5, "kg", 0.9),
      ],
    },
    {
      key: "f5",
      supplier: "ortofrutta",
      number: "DEMO-F5",
      dateOffset: -1,
      dueOffset: 29,
      location: "dispensa",
      approve: false,
      paid: false,
      lines: [
        line("cipolla", "Cipolla (demo)", "CIP-05", 3, "kg", 1.2),
        line("carota", "Carota (demo)", "CAR-03", 2, "kg", 1.1),
      ],
    },
  ];

  const recipes: DemoRecipe[] = [
    {
      key: "soffritto",
      type: "sub",
      name: "Soffritto (demo)",
      outputQty: 1,
      outputUnit: "kg",
      versions: [
        {
          lines: [
            { ingredient: "cipolla", qty: 0.4, unit: "kg" },
            { ingredient: "carota", qty: 0.3, unit: "kg" },
            { ingredient: "sedano", qty: 0.3, unit: "kg" },
          ],
        },
      ],
    },
    {
      key: "ragu",
      type: "batch",
      name: "Ragù di manzo (demo)",
      outputQty: 8,
      outputUnit: "kg",
      portionsPerBatch: 40,
      shelfLifeHours: 72,
      versions: [
        {
          lines: [
            { ingredient: "manzo", qty: 5, unit: "kg" },
            { recipe: "soffritto", qty: 1, unit: "kg" },
            { ingredient: "passata", qty: 2, unit: "l" },
            { ingredient: "vino", qty: 0.5, unit: "l" },
            { ingredient: "acqua", qty: 1, unit: "l" },
          ],
        },
        {
          // Version 2: more wine.
          lines: [
            { ingredient: "manzo", qty: 5, unit: "kg" },
            { recipe: "soffritto", qty: 1, unit: "kg" },
            { ingredient: "passata", qty: 2, unit: "l" },
            { ingredient: "vino", qty: 1, unit: "l" },
            { ingredient: "acqua", qty: 1, unit: "l" },
          ],
        },
      ],
      rules: { minPortions: 75, targetPortions: 120 },
    },
    {
      key: "crema",
      type: "batch",
      name: "Crema pasticcera (demo)",
      outputQty: 2.5,
      outputUnit: "kg",
      portionsPerBatch: 20,
      shelfLifeHours: 18,
      versions: [
        {
          lines: [
            { ingredient: "latte", qty: 1, unit: "l" },
            { ingredient: "uova", qty: 12, unit: "pz" },
            { ingredient: "zucchero", qty: 0.4, unit: "kg" },
            { ingredient: "farina", qty: 0.2, unit: "kg" },
          ],
        },
      ],
      rules: { minPortions: 25, targetPortions: 40 },
    },
    {
      key: "tagliatelle",
      type: "plate",
      name: "Tagliatelle al ragù (demo)",
      salePrice: 14,
      versions: [{ lines: [{ recipe: "ragu", qty: 1, unit: "porz" }] }],
    },
    {
      key: "bigne",
      type: "plate",
      name: "Bignè alla crema (demo)",
      salePrice: 6.5,
      versions: [{ lines: [{ recipe: "crema", qty: 1, unit: "porz" }] }],
    },
  ];

  return {
    today,
    tenant: { name: TENANT_NAME, vat: TENANT_VAT },
    owner: { name: "Titolare (demo)" },
    admin: { name: "Supporto DigiAlto (demo)", email: ADMIN_EMAIL },
    staff: [
      { key: "bruno", name: "Chef Bruno (demo)", role: "chef" },
      { key: "lia", name: "Cuoca Lia (demo)", role: "chef" },
      { key: "teo", name: "Cameriere Teo (demo)", role: "waiter" },
      { key: "ada", name: "Cameriera Ada (demo)", role: "waiter" },
    ],
    devices: [
      { key: "cucina", label: "Tablet cucina (demo)", revoke: false, kitchen: true },
      { key: "sala", label: "Telefono sala (demo)", revoke: true, kitchen: false },
    ],
    locations: [
      { key: "cella", name: "Cella frigo (demo)" },
      { key: "dispensa", name: "Dispensa (demo)" },
    ],
    suppliers: [
      {
        key: "macelleria",
        name: "Macelleria Fittizia (demo)",
        vat: "IT00000001016",
        paymentTermsDays: 30,
        deliveryWeekdays: [1, 4],
        orderCutoffTime: "11:00",
        leadTimeDays: 2,
      },
      {
        key: "ortofrutta",
        name: "Ortofrutta Inventata (demo)",
        vat: "IT00000001024",
        paymentTermsDays: 30,
        deliveryWeekdays: [2, 5],
        orderCutoffTime: "10:00",
        leadTimeDays: 1,
      },
      {
        key: "latteria",
        name: "Latteria Immaginaria (demo)",
        vat: "IT00000001032",
        paymentTermsDays: 30,
        deliveryWeekdays: [1, 2, 3, 4, 5, 6],
        orderCutoffTime: null,
        leadTimeDays: 1,
      },
    ],
    ingredients,
    invoices,
    costSettings: { price_variance_pct: 8 },
    fixedCosts: { month: `${today.slice(0, 8)}01`, rent: 1800, labour: 6500, utilities: 450 },
    recipes,
    ingredientRules: [{ ingredient: "guanciale", minLevel: 3, targetLevel: 6 }],
    critical: ["manzo", "guanciale"],
    staffMealRule: { recipe: "ragu", defaultCount: 4 },
    stockOps: {
      transfers: [{ ingredient: "carota", qty: 1, unit: "kg", from: "dispensa", to: "cella" }],
      waste: [
        { ingredient: "cipolla", qty: 0.3, unit: "kg", reason: "spoilage", location: "dispensa" },
      ],
      manualUse: [{ ingredient: "farina", qty: 0.5, unit: "kg", location: "cella" }],
    },
    productions: [
      { key: "ragu1", recipe: "ragu", outputQty: 8 },
      { key: "ragu2", recipe: "ragu", outputQty: 8 },
      { key: "crema1", recipe: "crema", outputQty: 2.5 },
    ],
    batchActions: {
      split: { from: "ragu1", portions: 20, hoursFromNow: 48, location: "cella" },
      discard: { from: "ragu2", portions: 6, reason: "breakage" },
      staffMeal: { count: 4 },
      adjust: { from: "ragu2", byPortions: -2 },
    },
    count: {
      location: "cella",
      type: "daily",
      counted: [
        { ingredient: "manzo", qty: 7.6, unit: "kg" },
        { ingredient: "guanciale", qty: 2, unit: "kg" },
      ],
    },
    expected: {
      onHand: {
        manzo: { cella: 7.6, dispensa: 0 },
        guanciale: { cella: 2, dispensa: 0 },
        cipolla: { cella: 0, dispensa: 3.9 },
        carota: { cella: 1, dispensa: 1.4 },
        sedano: { cella: 0, dispensa: 1.4 },
        passata: { cella: 0, dispensa: 8 },
        vino: { cella: 0, dispensa: 4 },
        latte: { cella: 3, dispensa: 0 },
        uova: { cella: 6, dispensa: 0 },
        zucchero: { cella: 1.6, dispensa: 0 },
        farina: { cella: 4.3, dispensa: 0 },
      },
      portions: { ragu: 68, crema: 20 },
      variance: [
        { ingredient: "manzo", expected: 8, counted: 7.6, difference: -0.4 },
        { ingredient: "guanciale", expected: 2, counted: 2, difference: 0 },
      ],
      alertKinds: [
        "prep_due",
        "prep_raw_short",
        "purchase_due",
        "raw_lot_expiring",
        "batch_expiring",
        "price_variance",
        "payable_due_7d",
        "payable_overdue_3d",
        "payables_weekly_digest",
      ],
      payables: { f1: "overdue", f2: "open", f3: "due_soon", f4: "paid" },
      invoicesApproved: 4,
      invoicesInReview: 1,
    },
  };
}

function ing(
  key: string,
  name: string,
  unit: Unit,
  category: string,
  home: string,
  allergens: string[],
): Ingredient {
  return { key, name, unit, isStock: true, category, home, allergens };
}

function line(
  ingredient: string,
  description: string,
  code: string,
  qty: number,
  unit: Unit,
  unitPrice: number,
): InvoiceLine {
  return { ingredient, description, code, qty, unit, unitPrice };
}
