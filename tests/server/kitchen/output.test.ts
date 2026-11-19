import { describe, expect, it } from "vitest";
import { z } from "zod";
import { kitchenTicketsOutput, markLineOutput, markTicketOutput } from "@/server/kitchen/output";
import { KITCHEN_TICKETS } from "../../helpers/kitchen-data";

// Every property name of a schema, at any depth, through its JSON Schema.
function propertyNames(schema: z.ZodType): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === "object") {
        names.push(...Object.keys(record.properties));
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(z.toJSONSchema(schema, { io: "output" }));
  return names;
}

// pgTAP 059's chef regex: the chef sees no euro value, so no key of the kitchen list may look like one.
const CHEF_FORBIDDEN = /cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo/i;

describe("kitchenTicketsOutput (comanda per uscita, plan 2026-11-18 §3.9)", () => {
  const ticket = KITCHEN_TICKETS.tickets[1]!;

  it("refuses a ticket with course or segue and accepts uscita, addition, calledAt", () => {
    const withTicket = (t: object) => ({ ...KITCHEN_TICKETS, tickets: [t] });
    expect(kitchenTicketsOutput.safeParse(withTicket(ticket)).success).toBe(true);
    expect(ticket).toMatchObject({ uscita: 2, addition: false, calledAt: ticket.firedAt });
    expect(kitchenTicketsOutput.safeParse(withTicket({ ...ticket, course: "primi" })).success).toBe(
      false,
    );
    expect(kitchenTicketsOutput.safeParse(withTicket({ ...ticket, segue: true })).success).toBe(
      false,
    );
    for (const key of ["uscita", "addition", "calledAt"] as const) {
      const { [key]: _drop, ...without } = ticket;
      expect(kitchenTicketsOutput.safeParse(withTicket(without)).success, key).toBe(false);
    }
  });

  it("refuses an uscita outside 0..9 or not an integer, and a calledAt that is not the six-decimal UTC text", () => {
    const withTicket = (t: object) => ({ ...KITCHEN_TICKETS, tickets: [t] });
    for (const uscita of [-1, 10, 1.5, "2"]) {
      expect(
        kitchenTicketsOutput.safeParse(withTicket({ ...ticket, uscita })).success,
        String(uscita),
      ).toBe(false);
    }
    expect(
      kitchenTicketsOutput.safeParse(
        withTicket({ ...ticket, calledAt: "2026-11-04T19:40:00+00:00" }),
      ).success,
    ).toBe(false);
  });

  it("each line carries its course; a waiting item has no done and no mark target", () => {
    const line = ticket.lines[0]!;
    const { course: _c, ...noCourse } = line;
    expect(
      kitchenTicketsOutput.safeParse({
        ...KITCHEN_TICKETS,
        tickets: [{ ...ticket, lines: [noCourse] }],
      }).success,
    ).toBe(false);
    const waiting = KITCHEN_TICKETS.waiting[0]!;
    const withWaiting = (w: object) => ({ ...KITCHEN_TICKETS, waiting: [w] });
    expect(
      kitchenTicketsOutput.safeParse(
        withWaiting({ ...waiting, lines: [{ ...waiting.lines[0]!, done: false }] }),
      ).success,
    ).toBe(false);
    expect(kitchenTicketsOutput.safeParse(withWaiting({ ...waiting, key: "x" })).success).toBe(
      false,
    );
    expect(kitchenTicketsOutput.safeParse(withWaiting({ ...waiting, uscita: 1 })).success).toBe(
      false,
    );
  });

  it("refuses a reply without waiting or waitingCount", () => {
    const { waiting: _w, ...noWaiting } = KITCHEN_TICKETS;
    expect(kitchenTicketsOutput.safeParse(noWaiting).success).toBe(false);
    const { waitingCount: _n, ...noCount } = KITCHEN_TICKETS;
    expect(kitchenTicketsOutput.safeParse(noCount).success).toBe(false);
  });
});

describe("kitchenTicketsOutput (M19)", () => {
  it("parses the database reply", () => {
    expect(kitchenTicketsOutput.parse(KITCHEN_TICKETS)).toEqual(KITCHEN_TICKETS);
  });

  it("has no property that matches the chef cost regex, nor unit, vat or recipe", () => {
    const names = propertyNames(kitchenTicketsOutput);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => CHEF_FORBIDDEN.test(n) || /unit|vat|recipe/i.test(n))).toEqual([]);
  });

  it("matches the committed JSON Schema (a change is deliberate)", () => {
    expect(z.toJSONSchema(kitchenTicketsOutput, { io: "output" })).toMatchSnapshot();
  });

  it("parses the closed comande and the counts", () => {
    const parsed = kitchenTicketsOutput.parse(KITCHEN_TICKETS);
    expect(parsed.remaining).toBe(2);
    expect(parsed.closedTickets.map((t) => [t.doneCount, t.lineCount, t.autoClosed])).toEqual([
      [2, 2, true],
      [0, 1, false],
    ]);
  });

  it("refuses a reply without the M19b keys", () => {
    const { remaining: _r, ...noRemaining } = KITCHEN_TICKETS;
    expect(kitchenTicketsOutput.safeParse(noRemaining).success).toBe(false);
    const { closedTickets: _c, ...noClosed } = KITCHEN_TICKETS;
    expect(kitchenTicketsOutput.safeParse(noClosed).success).toBe(false);
    expect(kitchenTicketsOutput.safeParse({ ...KITCHEN_TICKETS, remaining: -1 }).success).toBe(
      false,
    );
  });

  it("refuses an injected unit price or cost, at any level", () => {
    const withLine = (extra: object) => ({
      ...KITCHEN_TICKETS,
      tickets: [
        {
          ...KITCHEN_TICKETS.tickets[0]!,
          lines: [{ ...KITCHEN_TICKETS.tickets[0]!.lines[0]!, ...extra }],
        },
      ],
    });
    expect(kitchenTicketsOutput.safeParse(withLine({ unitPrice: 14 })).success).toBe(false);
    expect(kitchenTicketsOutput.safeParse(withLine({ unit_cost: 2.98 })).success).toBe(false);
    expect(kitchenTicketsOutput.safeParse({ ...KITCHEN_TICKETS, total: 1 }).success).toBe(false);
    expect(
      kitchenTicketsOutput.safeParse({
        ...KITCHEN_TICKETS,
        tickets: [{ ...KITCHEN_TICKETS.tickets[0]!, cost: 1 }],
      }).success,
    ).toBe(false);
  });

  it("accepts a voided line with a reason and refuses an unknown reason", () => {
    const voided = {
      ...KITCHEN_TICKETS.tickets[0]!.lines[0]!,
      voided: true,
      voidReason: "kitchen_error",
    };
    const reply = (line: object) => ({
      ...KITCHEN_TICKETS,
      tickets: [{ ...KITCHEN_TICKETS.tickets[0]!, lines: [line] }],
    });
    expect(kitchenTicketsOutput.safeParse(reply(voided)).success).toBe(true);
    expect(
      kitchenTicketsOutput.safeParse(reply({ ...voided, voidReason: "entry_removed" })).success,
    ).toBe(false);
  });

  it("an empty list is valid", () => {
    expect(
      kitchenTicketsOutput.safeParse({
        asOf: "2026-11-04T20:31:00+00:00",
        truncated: false,
        remaining: 0,
        waitingCount: 0,
        waiting: [],
        tickets: [],
        closedTickets: [],
      }).success,
    ).toBe(true);
  });
});

describe("markLineOutput and markTicketOutput (M19b)", () => {
  const line = { changed: true, autoClosed: false, reopened: false, board: KITCHEN_TICKETS };

  it("parse the replies of the two write procedures", () => {
    expect(markLineOutput.parse(line)).toEqual(line);
    expect(markTicketOutput.parse({ changed: false, board: KITCHEN_TICKETS })).toEqual({
      changed: false,
      board: KITCHEN_TICKETS,
    });
  });

  it("have no property that matches the chef cost regex", () => {
    for (const schema of [markLineOutput, markTicketOutput]) {
      expect(propertyNames(schema).filter((n) => CHEF_FORBIDDEN.test(n))).toEqual([]);
    }
  });

  it("refuse an injected unitPrice or total, at any level", () => {
    expect(markLineOutput.safeParse({ ...line, total: 1 }).success).toBe(false);
    expect(
      markTicketOutput.safeParse({ changed: true, board: KITCHEN_TICKETS, unitPrice: 1 }).success,
    ).toBe(false);
    const priced = {
      ...KITCHEN_TICKETS,
      tickets: [
        {
          ...KITCHEN_TICKETS.tickets[0]!,
          lines: [{ ...KITCHEN_TICKETS.tickets[0]!.lines[0]!, unitPrice: 14 }],
        },
      ],
    };
    expect(markLineOutput.safeParse({ ...line, board: priced }).success).toBe(false);
  });

  it("match the committed JSON Schemas (a change is deliberate)", () => {
    expect(z.toJSONSchema(markLineOutput, { io: "output" })).toMatchSnapshot();
    expect(z.toJSONSchema(markTicketOutput, { io: "output" })).toMatchSnapshot();
  });
});
