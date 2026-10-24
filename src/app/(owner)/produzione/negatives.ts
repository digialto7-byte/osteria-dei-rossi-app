/** A location a production left negative, worded for the label page (names come from the proposal the chef saw). */
export interface NegativeNote {
  ingredient: string;
  location: string;
  qty: number;
  unit: "kg" | "l" | "pz";
}

/** Where the production page leaves the notes for the label page of the same batch (session storage). */
export const negativesKey = (batchId: string) => `produzione-negativi:${batchId}`;
