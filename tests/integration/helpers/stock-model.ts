// An independent model of the raw stock ledger (M12 plan §3.1, ADR-011), written in TypeScript for the AT2 property
// test. It shares no code with the SQL: it holds the rows of every operation, derives every bucket by summing them,
// takes stock FEFO (override lot first, then expiry ascending with no expiry last, then received_on, then the lot id,
// then an explicit unlotted shortfall row), refuses what the procedures refuse, and reverses whole operations.
// Quantities are integers in ticks of 0,0001 (the database scale), so sums are exact.

export const TICKS = 10_000;
export const toTicks = (qty: number) => Math.round(qty * TICKS);
export const fromTicks = (ticks: number) => ticks / TICKS;

export type ModelErrorCode =
  | "lot_not_found"
  | "lot_empty"
  | "insufficient_stock"
  | "same_location"
  | "already_reversed"
  | "movement_is_reversal"
  | "movement_not_reversible"
  | "transfer_already_used";

export class ModelError extends Error {
  constructor(public readonly code: ModelErrorCode) {
    super(code);
    this.name = "ModelError";
  }
}

export interface ModelLot {
  id: string;
  ingredient: string;
  /** YYYY-MM-DD, or null for a lot without an expiry. */
  expiry: string | null;
  /** YYYY-MM-DD. */
  receivedOn: string;
}

export type OperationRef = "receipt" | "manual" | "transfer" | "reversal";

export interface ModelRow {
  index: number;
  operation: string;
  ingredient: string;
  location: string;
  /** The lot, or null for the unlotted bucket. */
  lot: string | null;
  /** Signed ticks. */
  ticks: number;
  reverses: number | null;
}

interface Operation {
  id: string;
  ref: OperationRef;
  rows: number[];
  reversedBy: string | null;
}

export interface Bucket {
  lot: string | null;
  ticks: number;
}

/** The ledger key of a bucket, as the property test compares it with the database view. */
export const bucketKey = (ingredient: string, location: string, lot: string | null) =>
  `${ingredient}|${location}|${lot ?? "null"}`;

export class StockModel {
  readonly rows: ModelRow[] = [];
  private readonly operations = new Map<string, Operation>();
  private readonly lots = new Map<string, ModelLot>();

  /** A receipt: registers the lot and books its quantity at a location. */
  receive(lot: ModelLot, location: string, ticks: number, operation = `receipt-${lot.id}`): void {
    this.lots.set(lot.id, lot);
    this.book(operation, "receipt", [
      { ingredient: lot.ingredient, location, lot: lot.id, ticks, reverses: null },
    ]);
  }

  bucket(ingredient: string, location: string, lot: string | null): number {
    let sum = 0;
    for (const row of this.rows) {
      if (row.ingredient === ingredient && row.location === location && row.lot === lot) {
        sum += row.ticks;
      }
    }
    return sum;
  }

  /** The location total: every bucket, the unlotted one included. */
  total(ingredient: string, location: string): number {
    let sum = 0;
    for (const row of this.rows) {
      if (row.ingredient === ingredient && row.location === location) sum += row.ticks;
    }
    return sum;
  }

  /** Every non-empty bucket, keyed as `bucketKey`. */
  buckets(): Map<string, number> {
    const sums = new Map<string, number>();
    for (const row of this.rows) {
      const key = bucketKey(row.ingredient, row.location, row.lot);
      sums.set(key, (sums.get(key) ?? 0) + row.ticks);
    }
    for (const [key, sum] of sums) if (sum === 0) sums.delete(key);
    return sums;
  }

  /** The totals per ingredient and location, keyed `ingredient|location`. */
  totals(): Map<string, number> {
    const sums = new Map<string, number>();
    for (const row of this.rows) {
      const key = `${row.ingredient}|${row.location}`;
      sums.set(key, (sums.get(key) ?? 0) + row.ticks);
    }
    return sums;
  }

  /** The positive buckets of an ingredient at a location in FEFO order. */
  positiveBuckets(ingredient: string, location: string): Bucket[] {
    const sums = new Map<string | null, number>();
    for (const row of this.rows) {
      if (row.ingredient === ingredient && row.location === location) {
        sums.set(row.lot, (sums.get(row.lot) ?? 0) + row.ticks);
      }
    }
    return [...sums]
      .filter(([, ticks]) => ticks > 0)
      .map(([lot, ticks]) => ({ lot, ticks }))
      .sort((a, b) => this.compareFefo(a.lot, b.lot));
  }

  /**
   * Consumption or waste: the override lot first (up to its bucket), then FEFO, then one unlotted shortfall row.
   * Never refuses for lack of stock. Returns the rows in insert order.
   */
  outflow(
    operation: string,
    ingredient: string,
    location: string,
    ticks: number,
    overrideLot?: string,
  ): ModelRow[] {
    const wanted: Omit<ModelRow, "index" | "operation">[] = [];
    let remaining = ticks;
    const take = (lot: string | null, amount: number) => {
      wanted.push({ ingredient, location, lot, ticks: -amount, reverses: null });
      remaining -= amount;
    };
    if (overrideLot !== undefined) {
      this.checkOverride(ingredient, location, overrideLot);
      take(overrideLot, Math.min(remaining, this.bucket(ingredient, location, overrideLot)));
    }
    if (remaining > 0) {
      const taken = new Map<string | null, number>(wanted.map((row) => [row.lot, -row.ticks]));
      for (const bucket of this.positiveBuckets(ingredient, location)) {
        if (remaining <= 0) break;
        take(bucket.lot, Math.min(remaining, bucket.ticks - (taken.get(bucket.lot) ?? 0)));
      }
    }
    if (remaining > 0) take(null, remaining);
    return this.book(
      operation,
      "manual",
      wanted.filter((row) => row.ticks !== 0),
    );
  }

  /**
   * A transfer: only positive buckets move, and never more than the location total (a negative unlotted bucket
   * counts against it); more than that is refused and nothing is booked.
   */
  transfer(
    operation: string,
    ingredient: string,
    from: string,
    to: string,
    ticks: number,
    overrideLot?: string,
  ): ModelRow[] {
    if (from === to) throw new ModelError("same_location");
    if (overrideLot !== undefined) this.checkOverride(ingredient, from, overrideLot);
    const buckets = this.positiveBuckets(ingredient, from);
    if (buckets.reduce((sum, bucket) => sum + bucket.ticks, 0) < ticks) {
      throw new ModelError("insufficient_stock");
    }
    if (this.total(ingredient, from) < ticks) throw new ModelError("insufficient_stock");
    const ordered =
      overrideLot === undefined
        ? buckets
        : [
            ...buckets.filter((bucket) => bucket.lot === overrideLot),
            ...buckets.filter((bucket) => bucket.lot !== overrideLot),
          ];
    const wanted: Omit<ModelRow, "index" | "operation">[] = [];
    let remaining = ticks;
    for (const bucket of ordered) {
      if (remaining <= 0) break;
      const slice = Math.min(remaining, bucket.ticks);
      wanted.push({ ingredient, location: from, lot: bucket.lot, ticks: -slice, reverses: null });
      wanted.push({ ingredient, location: to, lot: bucket.lot, ticks: slice, reverses: null });
      remaining -= slice;
    }
    return this.book(operation, "transfer", wanted);
  }

  /** Reverses a whole operation: one mirror row per original, in a new operation. */
  reverse(operation: string, target: string): ModelRow[] {
    const original = this.operations.get(target);
    if (!original) throw new ModelError("lot_not_found");
    if (original.ref === "reversal") throw new ModelError("movement_is_reversal");
    if (original.ref !== "manual" && original.ref !== "transfer") {
      throw new ModelError("movement_not_reversible");
    }
    if (original.reversedBy !== null) throw new ModelError("already_reversed");
    const originals = original.rows.map((index) => this.rows[index]!);
    if (original.ref === "transfer") {
      const wanted = new Map<string, number>();
      for (const row of originals.filter((r) => r.ticks > 0)) {
        const key = bucketKey(row.ingredient, row.location, row.lot);
        wanted.set(key, (wanted.get(key) ?? 0) + row.ticks);
      }
      for (const [key, ticks] of wanted) {
        const [ingredient, location, lot] = key.split("|") as [string, string, string];
        if (this.bucket(ingredient, location, lot === "null" ? null : lot) < ticks) {
          throw new ModelError("transfer_already_used");
        }
      }
    }
    const mirrors = originals.map((row) => ({
      ingredient: row.ingredient,
      location: row.location,
      lot: row.lot,
      ticks: -row.ticks,
      reverses: row.index,
    }));
    const rows = this.book(operation, "reversal", mirrors);
    original.reversedBy = operation;
    return rows;
  }

  /** The ids of the operations that can be reversed now (as far as the model knows, before the stock check). */
  reversibleOperations(): string[] {
    return [...this.operations.values()]
      .filter((op) => (op.ref === "manual" || op.ref === "transfer") && op.reversedBy === null)
      .map((op) => op.id);
  }

  operationIds(): string[] {
    return [...this.operations.keys()];
  }

  refOf(operation: string): OperationRef | undefined {
    return this.operations.get(operation)?.ref;
  }

  private checkOverride(ingredient: string, location: string, lot: string): void {
    const info = this.lots.get(lot);
    if (!info || info.ingredient !== ingredient) throw new ModelError("lot_not_found");
    if (this.bucket(ingredient, location, lot) <= 0) throw new ModelError("lot_empty");
  }

  // expiry ascending, no expiry last; then received_on; then the lot id; the unlotted bucket after every lot.
  private compareFefo(a: string | null, b: string | null): number {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const lotA = this.lots.get(a)!;
    const lotB = this.lots.get(b)!;
    if (lotA.expiry !== lotB.expiry) {
      if (lotA.expiry === null) return 1;
      if (lotB.expiry === null) return -1;
      return lotA.expiry < lotB.expiry ? -1 : 1;
    }
    if (lotA.receivedOn !== lotB.receivedOn) return lotA.receivedOn < lotB.receivedOn ? -1 : 1;
    return a < b ? -1 : 1;
  }

  private book(
    operation: string,
    ref: OperationRef,
    wanted: Omit<ModelRow, "index" | "operation">[],
  ): ModelRow[] {
    const booked = wanted.map((row) => {
      const full: ModelRow = { ...row, index: this.rows.length, operation };
      this.rows.push(full);
      return full;
    });
    this.operations.set(operation, {
      id: operation,
      ref,
      rows: booked.map((row) => row.index),
      reversedBy: null,
    });
    return booked;
  }
}
