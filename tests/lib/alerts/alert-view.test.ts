import { describe, expect, it } from "vitest";
import { ackLine, alertMeta, canReadAlerts, severityView } from "@/lib/alerts/alert-view";

describe("severityView", () => {
  it.each([
    ["info", "info", "Informazione"],
    ["warning", "warning", "Attenzione"],
    ["critical", "danger", "Urgente"],
  ] as const)("%s is tone %s with the word %s", (severity, tone, label) => {
    expect(severityView(severity)).toEqual({ tone, label });
  });

  it("speaks English on request", () => {
    expect(severityView("critical", "en").label).toBe("Urgent");
  });
});

describe("ackLine", () => {
  it("names the person when the server sent a name", () => {
    expect(ackLine({ at: "2026-10-25T08:12:00Z", byName: "Titolare Demo" })).toBe(
      "Visto il 25/10/2026, 09:12 da Titolare Demo",
    );
  });

  it("leaves the person out when there is no name (a chef reading someone else's ack)", () => {
    expect(ackLine({ at: "2026-10-25T08:12:00Z", byName: null })).toBe(
      "Visto il 25/10/2026, 09:12",
    );
  });

  it("shows the time in Europe/Rome across the DST change", () => {
    expect(ackLine({ at: "2026-10-25T00:30:00Z", byName: null })).toContain("25/10/2026, 02:30");
    expect(ackLine({ at: "2026-10-25T01:30:00Z", byName: null })).toContain("25/10/2026, 02:30");
    expect(ackLine({ at: "2027-03-28T01:30:00Z", byName: null })).toContain("28/03/2027, 03:30");
  });

  it("accepts the microsecond timestamps PostgREST returns", () => {
    expect(ackLine({ at: "2026-10-25T08:12:00.123456+00:00", byName: null })).toBe(
      "Visto il 25/10/2026, 09:12",
    );
  });
});

describe("alertMeta", () => {
  it("writes the creation instant in venue time", () => {
    expect(alertMeta("2026-10-25T01:30:00.5+00:00")).toBe("del 25/10/2026, 02:30");
  });
});

describe("canReadAlerts", () => {
  it.each([
    ["owner", true],
    ["chef", true],
    ["admin", false],
    ["waiter", false],
  ])("%s: %s", (role, allowed) => {
    expect(canReadAlerts(role)).toBe(allowed);
  });
});
