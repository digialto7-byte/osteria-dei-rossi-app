import { describe, expect, it } from "vitest";
import {
  addGroup,
  assignLine,
  groupOf,
  initialSplitForm,
  selectGroup,
  setGroupCovers,
  splitBodyFrom,
} from "@/lib/bill/split-form";
import { BIDS } from "../../helpers/bill-data";

describe("split form (data only: no amount is computed here)", () => {
  it("starts with two groups that share the covers", () => {
    const form = initialSplitForm(3);
    expect(form.groups).toHaveLength(2);
    expect(form.groups.map((g) => g.covers)).toEqual([2, 1]);
    expect(form.shared).toEqual([]);
    expect(form.selected).toBe(0);
  });

  it("starts with one cover for a table of one: 1 and 0", () => {
    expect(initialSplitForm(1).groups.map((g) => g.covers)).toEqual([1, 0]);
  });

  it("assigns a line to the selected group", () => {
    const form = assignLine(initialSplitForm(2), BIDS.line1, 0);
    expect(groupOf(form, BIDS.line1)).toBe(0);
  });

  it("moves a line between groups and never keeps it twice", () => {
    let form = assignLine(initialSplitForm(2), BIDS.line1, 0);
    form = assignLine(form, BIDS.line1, 1);
    expect(groupOf(form, BIDS.line1)).toBe(1);
    expect(form.groups[0]!.lineIds).toEqual([]);
    expect(form.groups[1]!.lineIds).toEqual([BIDS.line1]);
  });

  it("shares a line ('Da dividere'), and moves it back", () => {
    let form = assignLine(initialSplitForm(2), BIDS.line4, "shared");
    expect(groupOf(form, BIDS.line4)).toBe("shared");
    form = assignLine(form, BIDS.line4, 0);
    expect(form.shared).toEqual([]);
    expect(groupOf(form, BIDS.line4)).toBe(0);
  });

  it("an unassigned line has no group", () => {
    expect(groupOf(initialSplitForm(2), BIDS.line2)).toBeNull();
  });

  it("does not change the form it is given", () => {
    const form = initialSplitForm(2);
    assignLine(form, BIDS.line1, 0);
    expect(form.groups[0]!.lineIds).toEqual([]);
  });

  it("adds groups up to 20 and selects the new one", () => {
    let form = initialSplitForm(4);
    form = addGroup(form);
    expect(form.groups).toHaveLength(3);
    expect(form.selected).toBe(2);
    for (let i = 0; i < 30; i += 1) form = addGroup(form);
    expect(form.groups).toHaveLength(20);
  });

  it("selects a group and clamps to the existing ones", () => {
    const form = initialSplitForm(2);
    expect(selectGroup(form, 1).selected).toBe(1);
    expect(selectGroup(form, 5).selected).toBe(0);
    expect(selectGroup(form, -1).selected).toBe(0);
  });

  it("sets the covers of a group between 0 and 99", () => {
    const form = initialSplitForm(2);
    expect(setGroupCovers(form, 0, 5).groups[0]!.covers).toBe(5);
    expect(setGroupCovers(form, 0, -3).groups[0]!.covers).toBe(0);
    expect(setGroupCovers(form, 0, 500).groups[0]!.covers).toBe(99);
  });

  it("builds the request body from ids and covers only", () => {
    let form = initialSplitForm(3);
    form = assignLine(form, BIDS.line1, 0);
    form = assignLine(form, BIDS.line3, 1);
    form = assignLine(form, BIDS.line4, "shared");
    expect(splitBodyFrom(form)).toEqual({
      groups: [
        { lineIds: [BIDS.line1], covers: 2 },
        { lineIds: [BIDS.line3], covers: 1 },
      ],
      sharedLineIds: [BIDS.line4],
    });
  });
});
