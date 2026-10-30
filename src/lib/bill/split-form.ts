import { MAX_SPLIT_GROUPS } from "@/server/bill/constants";
import type { SplitBody } from "@/server/bill/schemas";

// The "per piatti" split as data (M21 plan §3.6): which line is on which bill, and how many covers each bill has. It keeps ids and counts
// only; the amounts of every bill come back from the server. Every function returns a new form.

export interface SplitGroup {
  covers: number;
  lineIds: string[];
}

export interface SplitForm {
  groups: SplitGroup[];
  /** "Da dividere": lines whose amount is split equally between the bills. */
  shared: string[];
  /** The bill a tapped line goes to. */
  selected: number;
}

const MAX_COVERS = 99;

/** Two bills that share the covers (the first takes the odd one). */
export function initialSplitForm(covers: number): SplitForm {
  const first = Math.ceil(covers / 2);
  return {
    groups: [
      { covers: first, lineIds: [] },
      { covers: covers - first, lineIds: [] },
    ],
    shared: [],
    selected: 0,
  };
}

export function groupOf(form: SplitForm, lineId: string): number | "shared" | null {
  if (form.shared.includes(lineId)) return "shared";
  const index = form.groups.findIndex((group) => group.lineIds.includes(lineId));
  return index === -1 ? null : index;
}

/** Puts the line on a bill (or "shared"), taking it off wherever it was. */
export function assignLine(form: SplitForm, lineId: string, target: number | "shared"): SplitForm {
  const groups = form.groups.map((group) => ({
    ...group,
    lineIds: group.lineIds.filter((id) => id !== lineId),
  }));
  let shared = form.shared.filter((id) => id !== lineId);
  if (target === "shared") shared = [...shared, lineId];
  else if (groups[target])
    groups[target] = { ...groups[target], lineIds: [...groups[target].lineIds, lineId] };
  return { ...form, groups, shared };
}

export function selectGroup(form: SplitForm, index: number): SplitForm {
  return { ...form, selected: form.groups[index] ? index : 0 };
}

/** Adds an empty bill (at most 20) and selects it. */
export function addGroup(form: SplitForm): SplitForm {
  if (form.groups.length >= MAX_SPLIT_GROUPS) return form;
  return {
    ...form,
    groups: [...form.groups, { covers: 0, lineIds: [] }],
    selected: form.groups.length,
  };
}

export function setGroupCovers(form: SplitForm, index: number, covers: number): SplitForm {
  if (!form.groups[index]) return form;
  const clamped = Math.min(MAX_COVERS, Math.max(0, Math.trunc(covers)));
  return {
    ...form,
    groups: form.groups.map((group, i) => (i === index ? { ...group, covers: clamped } : group)),
  };
}

export function splitBodyFrom(form: SplitForm): SplitBody {
  return {
    groups: form.groups.map((group) => ({ lineIds: [...group.lineIds], covers: group.covers })),
    sharedLineIds: [...form.shared],
  };
}
