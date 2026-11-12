import { describe, expect, it } from "vitest";
import { toWire } from "@/lib/sync/batch";
import { overlayOrder } from "@/lib/sync/overlay";
import type { OutboxOp } from "@/lib/sync/types";
import { PAYLOADS } from "@/server/sync/schemas";
import { ORDER_VIEW } from "../../helpers/orders-data";
import { SYNC_IDS } from "../../helpers/sync-data";

// An outbox entry exactly as the M20 build stored it (before P2-0b): no weight key in the payload or the label. A phone
// whose queue was written by that build must still show it and send it, byte for byte (plan D-10, AT-W9).
const STORED_BY_M20 = `{
  "kind": "add_line",
  "clientTs": "2026-11-02T19:30:05.000Z",
  "userId": "${SYNC_IDS.waiterDemo}",
  "payload": {
    "sessionId": "${SYNC_IDS.s1}",
    "lineId": "10000000-0000-4000-8000-000000000005",
    "menuItemId": "${SYNC_IDS.item}",
    "course": "secondi"
  },
  "scope": { "sessionId": "${SYNC_IDS.s1}", "lineId": "10000000-0000-4000-8000-000000000005" },
  "label": {
    "tableName": "Tavolo 1 (demo)",
    "dishName": "Spezzatino con polenta (demo)",
    "qty": 1,
    "unitPrice": 14
  },
  "queuedBy": { "id": "${SYNC_IDS.waiterDemo}", "displayName": "Cameriere Demo" },
  "opId": "0e000000-0000-4000-8000-000000000005",
  "seq": 5,
  "attempts": 0,
  "lastAttemptAt": null
}`;

const op = JSON.parse(STORED_BY_M20) as OutboxOp;

describe("an outbox entry stored by the M20 build", () => {
  it("is sent with a byte-identical payload", () => {
    const sent = toWire(op).payload;
    expect(JSON.stringify(sent)).toBe(JSON.stringify(JSON.parse(STORED_BY_M20).payload));
    expect(Object.keys(sent)).toEqual(["sessionId", "lineId", "menuItemId", "course"]);
  });

  it("still passes the strict payload schema", () => {
    expect(PAYLOADS.add_line.safeParse(op.payload).success).toBe(true);
  });

  it("renders its label as a portion line with the queued price", () => {
    const line = overlayOrder(ORDER_VIEW, [op], SYNC_IDS.s1)!.lines.find(
      (l) => l.id === op.scope.lineId,
    )!;
    expect(line).toMatchObject({
      name: "Spezzatino con polenta (demo)",
      qty: 1,
      unitPrice: 14,
      weightG: null,
      pricePer100g: null,
      queue: "add",
    });
  });
});
